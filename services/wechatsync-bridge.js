const DEFAULT_WECHATSYNC_PORT = 9527;
const DEFAULT_REQUEST_TIMEOUT_MS = 360000;
const DEFAULT_CONNECT_TIMEOUT_MS = 60000;
const DEFAULT_PLATFORM_REQUEST_TIMEOUT_MS = 60000;
const DEFAULT_SYNC_REQUEST_TIMEOUT_MS = 180000;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function isUnsupportedBridgeMethodError(error = {}) {
  const message = String(error?.message || error || '');
  return /unknown method|unknown tool|method not found|not supported|unsupported/i.test(message);
}

function createEmitter() {
  const listeners = new Map();
  return {
    on(event, handler) {
      const handlers = listeners.get(event) || [];
      handlers.push(handler);
      listeners.set(event, handlers);
      return this;
    },
    once(event, handler) {
      const wrapped = (...args) => {
        this.off(event, wrapped);
        handler(...args);
      };
      return this.on(event, wrapped);
    },
    off(event, handler) {
      const handlers = listeners.get(event) || [];
      listeners.set(event, handlers.filter((item) => item !== handler));
      return this;
    },
    emit(event, ...args) {
      const handlers = listeners.get(event) || [];
      for (const handler of handlers.slice()) {
        handler(...args);
      }
    },
  };
}

function encodeWebSocketTextFrame(text) {
  const payload = Buffer.from(String(text));
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

function parseWebSocketFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) === 0x80;
    let payloadLength = secondByte & 0x7f;
    let cursor = offset + 2;

    if (payloadLength === 126) {
      if (cursor + 2 > buffer.length) break;
      payloadLength = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (payloadLength === 127) {
      if (cursor + 8 > buffer.length) break;
      const longLength = buffer.readBigUInt64BE(cursor);
      if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('WebSocket frame is too large.');
      }
      payloadLength = Number(longLength);
      cursor += 8;
    }

    let mask = null;
    if (masked) {
      if (cursor + 4 > buffer.length) break;
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }

    if (cursor + payloadLength > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + payloadLength));
    if (mask) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] = payload[i] ^ mask[i % 4];
      }
    }

    if (opcode === 0x1) {
      messages.push(payload.toString('utf8'));
    }
    if (opcode === 0x8) {
      messages.push({ __ws_control: 'close', code: payloadLength });
    }
    if (opcode === 0x9) {
      messages.push({ __ws_control: 'ping', payload });
    }
    offset = cursor + payloadLength;
  }

  return {
    messages,
    remaining: buffer.subarray(offset),
  };
}

function createSocketWrapper(socket) {
  const emitter = createEmitter();
  const wrapper = {
    readyState: 1,
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
    send(data) {
      if (wrapper.readyState !== 1) return;
      socket.write(encodeWebSocketTextFrame(data));
    },
    close() {
      wrapper.readyState = 3;
      socket.end();
    },
  };

  let buffered = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    try {
      buffered = Buffer.concat([buffered, chunk]);
      const result = parseWebSocketFrames(buffered);
      buffered = result.remaining;
      for (const message of result.messages) {
        if (typeof message === 'object' && message !== null && message.__ws_control) {
          if (message.__ws_control === 'ping') {
            const pongFrame = Buffer.alloc(2 + message.payload.length);
            pongFrame[0] = 0x8A;
            pongFrame[1] = message.payload.length;
            message.payload.copy(pongFrame, 2);
            socket.write(pongFrame);
          }
          if (message.__ws_control === 'close') {
            wrapper.readyState = 3;
            socket.end();
          }
          continue;
        }
        emitter.emit('message', Buffer.from(message));
      }
    } catch (error) {
      emitter.emit('error', error);
      socket.destroy();
    }
  });
  socket.on('close', () => {
    wrapper.readyState = 3;
    emitter.emit('close');
  });
  socket.on('error', (error) => {
    wrapper.readyState = 3;
    emitter.emit('error', error);
  });

  return wrapper;
}

function createMinimalWebSocketServer({ http, port, logger = console }) {
  const crypto = require('crypto');
  const emitter = createEmitter();
  const server = http.createServer();
  const sockets = new Set();

  server.on('upgrade', (req, socket) => {
    logger.debug?.('[WechatsyncBridge] WebSocket upgrade received', {
      url: req.url,
      origin: req.headers.origin || '',
      userAgent: req.headers['user-agent'] || '',
    });
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      logger.warn?.('[WechatsyncBridge] WebSocket upgrade rejected: missing sec-websocket-key');
      socket.destroy();
      return;
    }

    const accept = crypto
      .createHash('sha1')
      .update(`${key}${WS_GUID}`)
      .digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'));

    const wrapped = createSocketWrapper(socket);
    sockets.add(wrapped);
    wrapped.on('close', () => sockets.delete(wrapped));
    emitter.emit('connection', wrapped);
  });
  server.on('error', (error) => emitter.emit('error', error));
  server.listen(port, () => emitter.emit('listening'));

  return {
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
    close(callback) {
      for (const socket of sockets) {
        try {
          socket.close();
        } catch (error) {
          logger.warn?.('Failed to close Wechatsync socket:', error);
        }
      }
      server.close(callback);
    },
  };
}

function getWebSocketOpenState(WebSocketServer) {
  return WebSocketServer?.OPEN || WebSocketServer?.WebSocket?.OPEN || 1;
}

function createReadableBridgeError(error) {
  const message = String(error?.message || error || '');
  if (/Invalid or missing token|MCP token not configured|401|403/i.test(message)) {
    const friendly = new Error('Wechatsync 扩展已响应，但鉴权失败。请在 Wechatsync 扩展中开启 MCP/桥接，并确认 Obsidian 与扩展使用同一个 Token。');
    friendly.code = 'AUTH_FAILED';
    friendly.cause = error;
    return friendly;
  }
  if (/Extension not connected|not connected|timeout:no_extension/i.test(message)) {
    const friendly = new Error('尚未连接到 Wechatsync 浏览器扩展。请在已登录目标平台的 Chromium 浏览器中安装并启用 Wechatsync 扩展，然后开启 MCP/桥接。');
    friendly.code = 'EXTENSION_NOT_CONNECTED';
    friendly.cause = error;
    return friendly;
  }
  if (/Request timeout: listPlatforms/i.test(message)) {
    const friendly = new Error('Wechatsync 扩展已连接，但读取平台列表超时。平台较多或部分平台检查较慢时可能发生，请稍后重试。');
    friendly.code = 'PLATFORM_LIST_TIMEOUT';
    friendly.cause = error;
    return friendly;
  }
  if (/Request timeout: syncArticle/i.test(message)) {
    const friendly = new Error('Wechatsync 扩展长时间没有返回同步结果。浏览器扩展可能仍在后台处理，请先到扩展历史或目标平台草稿箱确认结果；如果某个平台卡住，建议减少平台后重试。');
    friendly.code = 'SYNC_TIMEOUT';
    friendly.cause = error;
    return friendly;
  }
  if (/Request timeout: (health|listSupportedPlatforms|enqueueSyncArticle|getSyncTask|getSyncTaskLink|openSyncTask|getAuthSnapshot)/i.test(message)) {
    const friendly = new Error('Wechatsync 扩展响应超时，请确认扩展已开启 MCP/桥接后重试。');
    friendly.code = 'BRIDGE_REQUEST_TIMEOUT';
    friendly.cause = error;
    return friendly;
  }
  if (/EADDRINUSE|Primary|ECONNREFUSED|not reachable/i.test(message)) {
    const friendly = new Error('无法连接 Wechatsync 本地桥接服务。请确认没有其他同步进程占用端口，或稍后重试。');
    friendly.code = 'BRIDGE_UNAVAILABLE';
    friendly.cause = error;
    return friendly;
  }
  return error instanceof Error ? error : new Error(message || 'Wechatsync 桥接请求失败。');
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function createWechatSyncBridgeService(options = {}) {
  const {
    WebSocketServer,
    http,
    port = DEFAULT_WECHATSYNC_PORT,
    token = '',
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    logger = console,
    idFactory = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
  } = options;

  if (!http) {
    throw new Error('http module is required to create Wechatsync bridge service.');
  }

  let wss = null;
  let httpServer = null;
  let client = null;
  let isServerMode = false;
  const pendingRequests = new Map();
  const connectionResolvers = [];
  const wsOpenState = getWebSocketOpenState(WebSocketServer);

  function debug(message, details) {
    logger.debug?.(`[WechatsyncBridge] ${message}`, details || '');
  }

  function isPrimaryConnected() {
    return !!(client && client.readyState === wsOpenState);
  }

  function notifyConnected() {
    while (connectionResolvers.length > 0) {
      const resolve = connectionResolvers.shift();
      resolve();
    }
  }

  async function startHttpApi() {
    httpServer = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method === 'GET' && req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ connected: isPrimaryConnected(), mode: 'primary' }));
        return;
      }

      if (req.method === 'POST' && req.url === '/request') {
        try {
          const body = await readRequestBody(req);
          const { method, params, timeoutMs } = JSON.parse(body || '{}');
          const result = await requestInternal(method, params, { timeoutMs });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message || String(error) }));
        }
        return;
      }

      if (req.method === 'POST' && req.url === '/send') {
        try {
          const body = await readRequestBody(req);
          const { method, params } = JSON.parse(body || '{}');
          const result = sendInternal(method, params);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message || String(error) }));
        }
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    await new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port + 1, () => {
        httpServer.off?.('error', reject);
        resolve();
      });
    });
  }

  async function startServer() {
    await new Promise((resolve, reject) => {
      try {
        wss = WebSocketServer
          ? new WebSocketServer({ port })
          : createMinimalWebSocketServer({ http, port, logger });
      } catch (error) {
        reject(error);
        return;
      }

      wss.once('listening', resolve);
      wss.once('error', reject);
      wss.on('connection', (ws) => {
        client = ws;
        debug('Extension connected', { port, mode: 'primary' });
        notifyConnected();

        ws.on('message', (data) => {
          handleMessage(data.toString());
        });
        ws.on('close', () => {
          if (client === ws) client = null;
        });
        ws.on('error', (error) => {
          logger.warn?.('Wechatsync bridge WebSocket error:', error);
        });
      });
    });

    try {
      await startHttpApi();
    } catch (error) {
      if (wss) {
        await new Promise((resolve) => wss.close(resolve));
        wss = null;
      }
      throw error;
    }
  }

  async function checkPrimaryHealth() {
    return new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost',
        port: port + 1,
        path: '/status',
        method: 'GET',
        timeout: 3000,
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const status = JSON.parse(body);
            resolve({ connected: !!status.connected, mode: status.mode || 'primary' });
          } catch {
            resolve({ connected: false, error: 'Invalid response from primary bridge.' });
          }
        });
      });

      req.on('error', (error) => resolve({ connected: false, error: error.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ connected: false, error: 'Primary bridge health check timeout.' });
      });
      req.end();
    });
  }

  async function start() {
    if (wss || isServerMode) {
      return getStatus();
    }

    try {
      await startServer();
      isServerMode = true;
      debug('Primary bridge started', { port, httpPort: port + 1 });
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') {
        throw createReadableBridgeError(error);
      }
      isServerMode = false;
      debug('Using existing primary bridge', { port, httpPort: port + 1 });
    }

    return getStatus();
  }

  async function stop() {
    for (const [id, pending] of pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Request cancelled: ${id}`));
    }
    pendingRequests.clear();

    if (wss) {
      await new Promise((resolve) => wss.close(resolve));
      wss = null;
    }
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
      httpServer = null;
    }
    client = null;
    isServerMode = false;
  }

  function waitForPrimaryConnection(timeoutMs = connectTimeoutMs) {
    if (isPrimaryConnected()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = connectionResolvers.indexOf(resolve);
        if (index >= 0) connectionResolvers.splice(index, 1);
        reject(createReadableBridgeError(new Error('timeout:no_extension')));
      }, timeoutMs);

      connectionResolvers.push(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  async function waitForConnection(timeoutMs = connectTimeoutMs) {
    if (isServerMode) {
      return waitForPrimaryConnection(timeoutMs);
    }

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const health = await checkPrimaryHealth();
      if (health.connected) return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw createReadableBridgeError(new Error('timeout:no_extension'));
  }

  function handleMessage(data) {
    let message;
    try {
      message = JSON.parse(data);
    } catch (error) {
      logger.warn?.('Failed to parse Wechatsync bridge response:', error);
      return;
    }

    const pending = pendingRequests.get(message.id);
    if (!pending) {
      debug('Received response for one-way, unknown, or timed out request', {
        id: message.id,
        hasError: !!message.error,
        resultKind: Array.isArray(message.result) ? 'array' : typeof message.result,
      });
      return;
    }

    clearTimeout(pending.timeout);
    pendingRequests.delete(message.id);

    if (message.error) {
      const errorMessage = message.error.message || message.error.error || String(message.error);
      debug('Request failed', {
        id: message.id,
        method: pending.method,
        elapsedMs: Date.now() - pending.startedAt,
        error: errorMessage,
      });
      pending.reject(createReadableBridgeError(new Error(errorMessage)));
      return;
    }
    debug('Request completed', {
      id: message.id,
      method: pending.method,
      elapsedMs: Date.now() - pending.startedAt,
      resultKind: Array.isArray(message.result) ? 'array' : typeof message.result,
    });
    pending.resolve(message.result);
  }

  function requestInternal(method, params, options = {}) {
    if (!isPrimaryConnected()) {
      return Promise.reject(createReadableBridgeError(new Error('Extension not connected.')));
    }
    if (!method) {
      return Promise.reject(new Error('Wechatsync bridge method is required.'));
    }

    const id = idFactory();
    const message = { id, method, params };
    if (token) message.token = token;
    const timeoutMs = Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : requestTimeoutMs;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        debug('Request timed out', { id, method, timeoutMs });
        reject(createReadableBridgeError(new Error(`Request timeout: ${method}`)));
      }, timeoutMs);

      pendingRequests.set(id, { resolve, reject, timeout, method, startedAt: Date.now() });
      debug('Sending request', {
        id,
        method,
        timeoutMs,
        mode: 'primary',
        paramKeys: params && typeof params === 'object' ? Object.keys(params) : [],
      });
      client.send(JSON.stringify(message));
    });
  }

  function sendInternal(method, params) {
    if (!isPrimaryConnected()) {
      throw createReadableBridgeError(new Error('Extension not connected.'));
    }
    if (!method) {
      throw new Error('Wechatsync bridge method is required.');
    }

    const id = idFactory();
    const message = { id, method, params };
    if (token) message.token = token;
    debug('Sending one-way request', {
      id,
      method,
      mode: 'primary',
      paramKeys: params && typeof params === 'object' ? Object.keys(params) : [],
    });
    client.send(JSON.stringify(message));
    return { accepted: true, requestId: id, method };
  }

  function requestViaHttp(method, params, options = {}) {
    return new Promise((resolve, reject) => {
      const timeoutMs = Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
        ? Number(options.timeoutMs)
        : requestTimeoutMs;
      const data = JSON.stringify({ method, params, timeoutMs });
      const req = http.request({
        hostname: 'localhost',
        port: port + 1,
        path: '/request',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: timeoutMs,
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const response = JSON.parse(body || '{}');
            if (response.error) {
              reject(createReadableBridgeError(new Error(response.error)));
            } else {
              resolve(response.result);
            }
          } catch (error) {
            reject(createReadableBridgeError(error));
          }
        });
      });

      req.on('error', (error) => reject(createReadableBridgeError(error)));
      req.on('timeout', () => {
        req.destroy();
        debug('HTTP forwarded request timed out', { method, timeoutMs });
        reject(createReadableBridgeError(new Error(`Request timeout: ${method}`)));
      });
      req.write(data);
      req.end();
    });
  }

  function sendViaHttp(method, params) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({ method, params });
      const req = http.request({
        hostname: 'localhost',
        port: port + 1,
        path: '/send',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 5000,
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const response = JSON.parse(body || '{}');
            if (response.error) {
              reject(createReadableBridgeError(new Error(response.error)));
            } else {
              resolve(response.result);
            }
          } catch (error) {
            reject(createReadableBridgeError(error));
          }
        });
      });

      req.on('error', (error) => reject(createReadableBridgeError(error)));
      req.on('timeout', () => {
        req.destroy();
        reject(createReadableBridgeError(new Error('Primary bridge send timeout.')));
      });
      req.write(data);
      req.end();
    });
  }

  async function request(method, params, options = {}) {
    await start();
    if (isServerMode) {
      return requestInternal(method, params, options);
    }
    return requestViaHttp(method, params, options);
  }

  async function requestWithMethodFallback(method, fallbackMethod, params, options = {}) {
    try {
      return await request(method, params, options);
    } catch (error) {
      if (!fallbackMethod || !isUnsupportedBridgeMethodError(error)) throw error;
      debug('Retrying request with fallback method', {
        method,
        fallbackMethod,
        code: error?.code,
        message: error?.message || String(error),
      });
      return request(fallbackMethod, params, options);
    }
  }

  async function send(method, params) {
    await start();
    if (isServerMode) {
      return sendInternal(method, params);
    }
    return sendViaHttp(method, params);
  }

  function listPlatforms({ forceRefresh = false, timeoutMs = DEFAULT_PLATFORM_REQUEST_TIMEOUT_MS } = {}) {
    return request('listPlatforms', { forceRefresh }, { timeoutMs });
  }

  function health({ timeoutMs = 5000 } = {}) {
    return request('health', {}, { timeoutMs });
  }

  function listSupportedPlatforms({ timeoutMs = DEFAULT_PLATFORM_REQUEST_TIMEOUT_MS } = {}) {
    return requestWithMethodFallback('listSupportedPlatforms', 'list_supported_platforms', {}, { timeoutMs });
  }

  function checkAuth(platform, { timeoutMs = DEFAULT_PLATFORM_REQUEST_TIMEOUT_MS } = {}) {
    return requestWithMethodFallback('checkAuth', 'check_auth', { platform }, { timeoutMs });
  }

  function syncArticle({ platforms, title, markdown, content, cover, timeoutMs = DEFAULT_SYNC_REQUEST_TIMEOUT_MS }) {
    return request('syncArticle', {
      platforms,
      article: { title, markdown, content, cover },
    }, { timeoutMs });
  }

  function enqueueSyncArticle({ platforms, title, markdown, content, cover, source = 'obsidian', timeoutMs = 10000 }) {
    return requestWithMethodFallback('enqueueSyncArticle', 'enqueue_sync_article', {
      platforms,
      source,
      article: { title, markdown, content, cover },
    }, { timeoutMs });
  }

  function getSyncTask(syncIdOrOptions, { timeoutMs = 5000 } = {}) {
    const params = typeof syncIdOrOptions === 'object' && syncIdOrOptions !== null
      ? { syncId: syncIdOrOptions.syncId }
      : { syncId: syncIdOrOptions };
    return requestWithMethodFallback('getSyncTask', 'get_sync_task', params, { timeoutMs });
  }

  function getSyncTaskLink(syncIdOrOptions, { timeoutMs = 5000 } = {}) {
    const params = typeof syncIdOrOptions === 'object' && syncIdOrOptions !== null
      ? { syncId: syncIdOrOptions.syncId }
      : { syncId: syncIdOrOptions };
    return requestWithMethodFallback('getSyncTaskLink', 'get_sync_task_link', params, { timeoutMs });
  }

  function openSyncTask(syncIdOrOptions, { timeoutMs = 5000 } = {}) {
    const params = typeof syncIdOrOptions === 'object' && syncIdOrOptions !== null
      ? { syncId: syncIdOrOptions.syncId }
      : { syncId: syncIdOrOptions };
    return requestWithMethodFallback('openSyncTask', 'open_sync_task', params, { timeoutMs });
  }

  function getAuthSnapshot({ platforms = [], maxAgeMs = 86400000, timeoutMs = 5000 } = {}) {
    return requestWithMethodFallback('getAuthSnapshot', 'get_auth_snapshot', {
      platforms,
      maxAgeMs,
    }, { timeoutMs });
  }

  function sendArticle({ platforms, title, markdown, content, cover }) {
    return send('syncArticle', {
      platforms,
      article: { title, markdown, content, cover },
    });
  }

  async function getStatus() {
    if (isServerMode) {
      return { mode: 'primary', connected: isPrimaryConnected(), port };
    }
    const health = await checkPrimaryHealth();
    return { mode: 'secondary', connected: !!health.connected, port, error: health.error };
  }

  return {
    start,
    stop,
    waitForConnection,
    getStatus,
    health,
    listSupportedPlatforms,
    listPlatforms,
    checkAuth,
    syncArticle,
    enqueueSyncArticle,
    getSyncTask,
    getSyncTaskLink,
    openSyncTask,
    getAuthSnapshot,
    sendArticle,
    _request: request,
    _send: send,
  };
}

module.exports = {
  DEFAULT_WECHATSYNC_PORT,
  DEFAULT_SYNC_REQUEST_TIMEOUT_MS,
  createReadableBridgeError,
  createWechatSyncBridgeService,
  isUnsupportedBridgeMethodError,
  parseWebSocketFrames,
};
