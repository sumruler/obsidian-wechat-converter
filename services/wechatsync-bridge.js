const DEFAULT_WECHATSYNC_PORT = 9527;
const DEFAULT_REQUEST_TIMEOUT_MS = 360000;
const DEFAULT_CONNECT_TIMEOUT_MS = 60000;
const DEFAULT_PLATFORM_REQUEST_TIMEOUT_MS = 60000;
const DEFAULT_SYNC_REQUEST_TIMEOUT_MS = 180000;
const DEFAULT_HELLO_TIMEOUT_MS = 30000;
const LOCAL_BIND_HOST = '127.0.0.1';
const REMOTE_BIND_HOST = '0.0.0.0';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const HELLO_ERROR_TOKEN_MISMATCH = 'token_mismatch';
const HELLO_ERROR_INVALID_PAYLOAD = 'invalid_payload';
const HELLO_ERROR_TIMEOUT = 'hello_timeout';
const HELLO_ERROR_VERSION_UNSUPPORTED = 'version_unsupported';

function isUnsupportedBridgeMethodError(error = {}) {
  const message = String(error?.message || error || '');
  return /unknown method|unknown tool|method not found|not supported|unsupported/i.test(message);
}

function isRecoverableBridgeConnectionError(error = {}) {
  const code = error?.code || '';
  return ['EXTENSION_NOT_CONNECTED', 'EXTENSION_NOT_AUTHENTICATED', 'BRIDGE_UNAVAILABLE', 'BRIDGE_REQUEST_TIMEOUT'].includes(code);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryRecoverableBridgeOperation(operation, options = {}) {
  const {
    retries = 2,
    delayMs = 1000,
    delay = sleep,
    shouldRetry = isRecoverableBridgeConnectionError,
    logger = console,
    label = 'bridge request',
  } = options;
  let attempt = 0;

  while (true) {
    try {
      return await operation({ attempt });
    } catch (error) {
      const readableError = createReadableBridgeError(error);
      if (attempt >= retries || !shouldRetry(readableError, attempt)) {
        throw readableError;
      }
      attempt += 1;
      logger.debug?.('[WechatsyncBridge] retrying recoverable operation', {
        label,
        attempt,
        retries,
        delayMs,
        code: readableError?.code,
        message: readableError?.message || String(readableError),
      });
      await delay(delayMs, attempt, readableError);
    }
  }
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
      messages.push({
        __ws_control: 'close',
        code: payload.length >= 2 ? payload.readUInt16BE(0) : undefined,
      });
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

function isOriginAllowedForWebSocket(origin = '', { allowlist = null } = {}) {
  if (!allowlist) return true;
  const trimmed = String(origin || '').trim();
  if (!trimmed) return true; // empty origin = native / node client
  for (const pattern of allowlist) {
    if (typeof pattern === 'string') {
      if (pattern === '*' || pattern === trimmed) return true;
      if (pattern.endsWith('*') && trimmed.startsWith(pattern.slice(0, -1))) return true;
    } else if (pattern instanceof RegExp) {
      if (pattern.test(trimmed)) return true;
    }
  }
  return false;
}

function createMinimalWebSocketServer({ http, port, host = LOCAL_BIND_HOST, originAllowlist = null, logger = console }) {
  const crypto = require('crypto');
  const emitter = createEmitter();
  const server = http.createServer();
  const sockets = new Set();

  server.on('upgrade', (req, socket) => {
    const origin = req.headers.origin || '';
    logger.debug?.('[WechatsyncBridge] WebSocket upgrade received', {
      url: req.url,
      origin,
      userAgent: req.headers['user-agent'] || '',
    });

    if (originAllowlist && !isOriginAllowedForWebSocket(origin, { allowlist: originAllowlist })) {
      logger.warn?.('[WechatsyncBridge] WebSocket upgrade rejected: origin not allowed', { origin });
      try {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      } catch {}
      socket.destroy();
      return;
    }

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
    emitter.emit('connection', wrapped, { origin });
  });
  server.on('error', (error) => emitter.emit('error', error));
  server.listen(port, host, () => emitter.emit('listening'));

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
    const friendly = new Error('浏览器插件已响应，但连接令牌校验失败。请确认 Obsidian 与浏览器插件使用同一个连接令牌。');
    friendly.code = 'AUTH_FAILED';
    friendly.cause = error;
    return friendly;
  }
  if (/Extension not authenticated/i.test(message)) {
    const friendly = new Error('浏览器插件已连接但未通过认证。请确认插件已升级到支持安全握手的版本，且使用与 Obsidian 一致的连接令牌。');
    friendly.code = 'EXTENSION_NOT_AUTHENTICATED';
    friendly.cause = error;
    return friendly;
  }
  if (/Extension not connected|not connected|timeout:no_extension/i.test(message)) {
    const friendly = new Error('尚未连接到浏览器插件。请确认已在正在运行的 Chromium 浏览器中安装插件，并检查地址、端口和连接令牌。');
    friendly.code = 'EXTENSION_NOT_CONNECTED';
    friendly.cause = error;
    return friendly;
  }
  if (/Request timeout: listPlatforms/i.test(message)) {
    const friendly = new Error('浏览器插件已连接，但读取平台列表超时。平台较多或部分平台检查较慢时可能发生，请稍后重试。');
    friendly.code = 'PLATFORM_LIST_TIMEOUT';
    friendly.cause = error;
    return friendly;
  }
  if (/Request timeout: syncArticle/i.test(message)) {
    const friendly = new Error('浏览器插件长时间没有返回同步结果。插件可能仍在后台处理，请先到插件历史或目标平台草稿箱确认结果；如果某个平台卡住，建议减少平台后重试。');
    friendly.code = 'SYNC_TIMEOUT';
    friendly.cause = error;
    return friendly;
  }
  if (/Request timeout: (health|listSupportedPlatforms|enqueueSyncArticle|getSyncTask|getSyncTaskLink|openSyncTask|getAuthSnapshot)/i.test(message)) {
    const friendly = new Error('浏览器插件响应超时，请确认浏览器正在运行，地址、端口和连接令牌正确后重试。');
    friendly.code = 'BRIDGE_REQUEST_TIMEOUT';
    friendly.cause = error;
    return friendly;
  }
  if (/EADDRINUSE|Primary|ECONNREFUSED|not reachable/i.test(message)) {
    const friendly = new Error('无法连接本地服务。请确认没有其他同步进程占用端口，或稍后重试。');
    friendly.code = 'BRIDGE_UNAVAILABLE';
    friendly.cause = error;
    return friendly;
  }
  return error instanceof Error ? error : new Error(message || '浏览器插件连接请求失败。');
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

function defaultConnectionIdFactory() {
  try {
    const nodeCrypto = require('crypto');
    if (typeof nodeCrypto.randomUUID === 'function') {
      return nodeCrypto.randomUUID();
    }
  } catch {
    // Fall through to time-based id.
  }
  return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function createWechatSyncBridgeService(options = {}) {
  const {
    WebSocketServer,
    http,
    port = DEFAULT_WECHATSYNC_PORT,
    token = '',
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    helloTimeoutMs = DEFAULT_HELLO_TIMEOUT_MS,
    allowRemote = false,
    allowLegacyUnauthenticated = false,
    originAllowlist = null,
    serverVersion = '',
    logger = console,
    idFactory = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    connectionIdFactory = defaultConnectionIdFactory,
  } = options;

  if (!http) {
    throw new Error('http module is required to create Wechatsync bridge service.');
  }

  const bindHost = allowRemote ? REMOTE_BIND_HOST : LOCAL_BIND_HOST;

  let wss = null;
  let httpServer = null;
  /** @type {{ connectionId: string, ws: any, extensionInstanceId: string, extensionId: string, version: string, profileLabel: string, browserName: string, capabilities: object, connectedAt: number, authenticatedAt: number } | null} */
  let activeClient = null;
  const pendingConnections = new Map();
  const pendingRequests = new Map();
  const connectionResolvers = [];
  const wsOpenState = getWebSocketOpenState(WebSocketServer);
  const diagnostics = {
    socketsOpened: 0,
    helloAttempts: 0,
    helloRejections: 0,
    helloSuccesses: 0,
    lastHelloRejection: null,
  };

  function debug(message, details) {
    logger.debug?.(`[WechatsyncBridge] ${message}`, details || '');
  }

  function audit(event, details) {
    logger.info?.(`[WechatsyncBridge:audit] ${event}`, details || {});
  }

  function isClientSocketOpen(ws) {
    return !!(ws && ws.readyState === wsOpenState);
  }

  function isAuthenticatedConnected() {
    return !!(activeClient && isClientSocketOpen(activeClient.ws));
  }

  function notifyConnected() {
    while (connectionResolvers.length > 0) {
      const resolve = connectionResolvers.shift();
      resolve();
    }
  }

  function tryParseHelloPayload(message) {
    if (!message || typeof message !== 'object') return null;
    if (message.type !== 'extension_hello') return null;
    return {
      type: 'extension_hello',
      token: typeof message.token === 'string' ? message.token : '',
      extensionInstanceId: typeof message.extensionInstanceId === 'string' ? message.extensionInstanceId : '',
      extensionId: typeof message.extensionId === 'string' ? message.extensionId : '',
      version: typeof message.version === 'string' ? message.version : '',
      profileLabel: typeof message.profileLabel === 'string' ? message.profileLabel : '',
      browserName: typeof message.browserName === 'string' ? message.browserName : '',
      capabilities: message.capabilities && typeof message.capabilities === 'object' ? message.capabilities : {},
    };
  }

  function sendHelloAck(ws, { ok, connectionId = '', error = '' }) {
    try {
      const payload = ok
        ? {
            type: 'extension_hello_ack',
            ok: true,
            connectionId,
            mode: 'single-client',
            serverVersion: serverVersion || '',
          }
        : {
            type: 'extension_hello_ack',
            ok: false,
            error,
          };
      ws.send(JSON.stringify(payload));
    } catch (err) {
      logger.warn?.('Failed to send extension_hello_ack:', err);
    }
  }

  function closeWs(ws, reason) {
    try {
      ws.close?.();
    } catch (err) {
      debug('Failed to close socket', { reason, error: err?.message || String(err) });
    }
  }

  function removePendingConnection(connectionId) {
    const pending = pendingConnections.get(connectionId);
    if (!pending) return;
    if (pending.helloTimeout) clearTimeout(pending.helloTimeout);
    pendingConnections.delete(connectionId);
  }

  function promoteToActive(pending, hello, origin) {
    const previous = activeClient;
    const next = {
      connectionId: pending.connectionId,
      ws: pending.ws,
      extensionInstanceId: hello?.extensionInstanceId || '',
      extensionId: hello?.extensionId || '',
      version: hello?.version || '',
      profileLabel: hello?.profileLabel || '',
      browserName: hello?.browserName || '',
      capabilities: hello?.capabilities || {},
      connectedAt: pending.connectedAt,
      authenticatedAt: Date.now(),
      origin: origin || pending.origin || '',
    };

    if (previous && previous.connectionId !== next.connectionId && isClientSocketOpen(previous.ws)) {
      audit('replacement_authenticated', {
        old_connectionId: previous.connectionId,
        new_connectionId: next.connectionId,
        old_extensionInstanceId: previous.extensionInstanceId,
        new_extensionInstanceId: next.extensionInstanceId,
        old_connectedAt: previous.connectedAt,
        new_connectedAt: next.connectedAt,
        reason: 'replacement_authenticated',
      });
      closeWs(previous.ws, 'replaced-by-authenticated');
    }

    activeClient = next;
    removePendingConnection(pending.connectionId);
    debug('Extension authenticated', {
      connectionId: next.connectionId,
      extensionInstanceId: next.extensionInstanceId,
      profileLabel: next.profileLabel,
      browserName: next.browserName,
      version: next.version,
      legacy: !hello,
    });
    notifyConnected();
  }

  function rejectHello(pending, errorCode, details = {}) {
    diagnostics.helloAttempts += 1;
    diagnostics.helloRejections += 1;
    diagnostics.lastHelloRejection = {
      reason: errorCode,
      at: Date.now(),
      connectionId: pending.connectionId,
      details: { ...details },
    };
    audit('hello_rejected', {
      connectionId: pending.connectionId,
      reason: errorCode,
      ...details,
    });
    sendHelloAck(pending.ws, { ok: false, error: errorCode });
    removePendingConnection(pending.connectionId);
    closeWs(pending.ws, `hello_rejected:${errorCode}`);
  }

  function handlePendingMessage(pending, raw, origin) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      logger.warn?.('Failed to parse pending bridge message:', error);
      rejectHello(pending, HELLO_ERROR_INVALID_PAYLOAD, { parseError: true });
      return;
    }
    const hello = tryParseHelloPayload(parsed);
    if (!hello) {
      rejectHello(pending, HELLO_ERROR_INVALID_PAYLOAD, { receivedType: parsed?.type || '' });
      return;
    }
    if (token && hello.token !== token) {
      rejectHello(pending, HELLO_ERROR_TOKEN_MISMATCH, {
        extensionInstanceId: hello.extensionInstanceId,
        extensionId: hello.extensionId,
      });
      return;
    }
    diagnostics.helloAttempts += 1;
    diagnostics.helloSuccesses += 1;
    sendHelloAck(pending.ws, { ok: true, connectionId: pending.connectionId });
    promoteToActive(pending, hello, origin);
  }

  function handleActiveMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      logger.warn?.('Failed to parse Wechatsync bridge response:', error);
      return;
    }

    if (message?.type === 'extension_hello') {
      debug('Ignoring extension_hello on already-authenticated client');
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

  function registerConnection(ws, { origin = '' } = {}) {
    const connectionId = connectionIdFactory();
    diagnostics.socketsOpened += 1;
    const pending = {
      connectionId,
      ws,
      connectedAt: Date.now(),
      origin,
      helloTimeout: null,
    };
    pendingConnections.set(connectionId, pending);
    debug('Extension connected (pending hello)', { connectionId, origin });

    if (allowLegacyUnauthenticated) {
      // Backwards compatibility: legacy extension without hello support.
      audit('legacy_unauthenticated_promotion', { connectionId, origin });
      promoteToActive(pending, null, origin);
    } else {
      pending.helloTimeout = setTimeout(() => {
        if (!pendingConnections.has(connectionId)) return;
        rejectHello(pending, HELLO_ERROR_TIMEOUT, { timeoutMs: helloTimeoutMs });
      }, helloTimeoutMs);
    }

    ws.on('message', (data) => {
      const raw = data.toString();
      const stillPending = pendingConnections.get(connectionId);
      if (stillPending) {
        handlePendingMessage(stillPending, raw, origin);
        return;
      }
      if (activeClient && activeClient.connectionId === connectionId) {
        handleActiveMessage(raw);
      }
    });
    ws.on('close', () => {
      removePendingConnection(connectionId);
      if (activeClient && activeClient.connectionId === connectionId) {
        debug('Active client disconnected', { connectionId });
        activeClient = null;
      }
    });
    ws.on('error', (error) => {
      logger.warn?.('Wechatsync bridge WebSocket error:', error);
    });
  }

  function isAuthorizedHttpRequest(req) {
    if (!token) return { ok: true };
    const header = req.headers['authorization'] || req.headers['Authorization'] || '';
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || typeof value !== 'string') {
      return { ok: false, status: 401, reason: 'missing_authorization' };
    }
    const match = /^Bearer\s+(.+)$/i.exec(value.trim());
    if (!match) {
      return { ok: false, status: 401, reason: 'invalid_authorization_scheme' };
    }
    if (match[1].trim() !== token) {
      return { ok: false, status: 403, reason: 'invalid_token' };
    }
    return { ok: true };
  }

  function denyHttpRequest(res, status, reason) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: reason }));
  }

  async function startHttpApi() {
    httpServer = http.createServer(async (req, res) => {
      // §3.4: do not emit Access-Control-Allow-Origin by default; rely on
      // browser-enforced same-origin policy as the second defense layer.

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const auth = isAuthorizedHttpRequest(req);
      if (!auth.ok) {
        audit('http_request_unauthorized', {
          url: req.url,
          method: req.method,
          reason: auth.reason,
        });
        denyHttpRequest(res, auth.status, auth.reason);
        return;
      }

      if (req.method === 'GET' && req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          connected: isAuthenticatedConnected(),
          mode: 'primary',
          authenticated: isAuthenticatedConnected(),
          pendingConnections: pendingConnections.size,
          host: bindHost,
          allowRemote: !!allowRemote,
          allowLegacyUnauthenticated: !!allowLegacyUnauthenticated,
        }));
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
      httpServer.listen({ port: port + 1, host: bindHost }, () => {
        httpServer.off?.('error', reject);
        resolve();
      });
    });
  }

  async function startServer() {
    await new Promise((resolve, reject) => {
      try {
        wss = WebSocketServer
          ? new WebSocketServer({ port, host: bindHost })
          : createMinimalWebSocketServer({ http, port, host: bindHost, originAllowlist, logger });
      } catch (error) {
        reject(error);
        return;
      }

      wss.once('listening', resolve);
      wss.once('error', reject);
      wss.on('connection', (ws, request) => {
        // Both the ws library and our minimal server emit (ws, request|extras).
        const origin = request?.headers?.origin || request?.origin || '';
        registerConnection(ws, { origin });
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

  async function start() {
    if (wss) {
      return getStatus();
    }

    try {
      await startServer();
      debug('Bridge started', {
        port,
        httpPort: port + 1,
        host: bindHost,
        allowRemote,
        allowLegacyUnauthenticated,
      });
    } catch (error) {
      // §4.1: EADDRINUSE no longer silently degrades into SECONDARY mode.
      // Surface the failure so the user can fix port conflicts.
      throw createReadableBridgeError(error);
    }

    return getStatus();
  }

  async function stop() {
    for (const [id, pending] of pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Request cancelled: ${id}`));
    }
    pendingRequests.clear();

    for (const pending of pendingConnections.values()) {
      if (pending.helloTimeout) clearTimeout(pending.helloTimeout);
      closeWs(pending.ws, 'stop');
    }
    pendingConnections.clear();

    if (activeClient) {
      closeWs(activeClient.ws, 'stop');
      activeClient = null;
    }

    if (wss) {
      await new Promise((resolve) => wss.close(resolve));
      wss = null;
    }
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
      httpServer = null;
    }
  }

  function waitForConnection(timeoutMs = connectTimeoutMs) {
    if (isAuthenticatedConnected()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let wrappedResolve;
      const timeout = setTimeout(() => {
        const index = connectionResolvers.indexOf(wrappedResolve);
        if (index >= 0) connectionResolvers.splice(index, 1);
        reject(createReadableBridgeError(new Error('timeout:no_extension')));
      }, timeoutMs);

      wrappedResolve = () => {
        clearTimeout(timeout);
        resolve();
      };
      connectionResolvers.push(wrappedResolve);
    });
  }

  function requestInternal(method, params, options = {}) {
    if (!method) {
      return Promise.reject(new Error('Wechatsync bridge method is required.'));
    }
    if (!activeClient) {
      if (pendingConnections.size > 0) {
        return Promise.reject(createReadableBridgeError(new Error('Extension not authenticated.')));
      }
      return Promise.reject(createReadableBridgeError(new Error('Extension not connected.')));
    }
    if (!isClientSocketOpen(activeClient.ws)) {
      return Promise.reject(createReadableBridgeError(new Error('Extension not connected.')));
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
        connectionId: activeClient.connectionId,
        paramKeys: params && typeof params === 'object' ? Object.keys(params) : [],
      });
      activeClient.ws.send(JSON.stringify(message));
    });
  }

  function sendInternal(method, params) {
    if (!method) {
      throw new Error('Wechatsync bridge method is required.');
    }
    if (!activeClient) {
      if (pendingConnections.size > 0) {
        throw createReadableBridgeError(new Error('Extension not authenticated.'));
      }
      throw createReadableBridgeError(new Error('Extension not connected.'));
    }
    if (!isClientSocketOpen(activeClient.ws)) {
      throw createReadableBridgeError(new Error('Extension not connected.'));
    }

    const id = idFactory();
    const message = { id, method, params };
    if (token) message.token = token;
    debug('Sending one-way request', {
      id,
      method,
      connectionId: activeClient.connectionId,
      paramKeys: params && typeof params === 'object' ? Object.keys(params) : [],
    });
    activeClient.ws.send(JSON.stringify(message));
    return { accepted: true, requestId: id, method };
  }

  async function request(method, params, options = {}) {
    await start();
    return requestInternal(method, params, options);
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
    return sendInternal(method, params);
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

  function checkAuth(platformOrPlatforms, { timeoutMs = DEFAULT_PLATFORM_REQUEST_TIMEOUT_MS, forceRefresh = false } = {}) {
    const params = Array.isArray(platformOrPlatforms)
      ? { platforms: platformOrPlatforms, forceRefresh }
      : { platform: platformOrPlatforms, forceRefresh };
    return requestWithMethodFallback('checkAuth', 'check_auth', params, { timeoutMs });
  }

  function syncArticle({ platforms, title, markdown, content, cover, assets, timeoutMs = DEFAULT_SYNC_REQUEST_TIMEOUT_MS }) {
    return request('syncArticle', {
      platforms,
      article: { title, markdown, content, cover, assets },
    }, { timeoutMs });
  }

  function enqueueSyncArticle({
    platforms,
    title,
    markdown,
    content,
    cover,
    assets,
    source = 'obsidian',
    quotaPolicy,
    timeoutMs = 10000,
  }) {
    const params = {
      platforms,
      source,
      article: { title, markdown, content, cover, assets },
    };
    if (quotaPolicy === 'block' || quotaPolicy === 'truncate') {
      params.quotaPolicy = quotaPolicy;
    }
    return requestWithMethodFallback('enqueueSyncArticle', 'enqueue_sync_article', params, { timeoutMs });
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

  function sendArticle({ platforms, title, markdown, content, cover, assets }) {
    return send('syncArticle', {
      platforms,
      article: { title, markdown, content, cover, assets },
    });
  }

  async function getStatus() {
    return {
      mode: 'primary',
      connected: isAuthenticatedConnected(),
      authenticated: isAuthenticatedConnected(),
      pendingConnections: pendingConnections.size,
      host: bindHost,
      allowRemote: !!allowRemote,
      allowLegacyUnauthenticated: !!allowLegacyUnauthenticated,
      port,
      diagnostics: getDiagnostics(),
    };
  }

  function getDiagnostics() {
    return {
      socketsOpened: diagnostics.socketsOpened,
      helloAttempts: diagnostics.helloAttempts,
      helloRejections: diagnostics.helloRejections,
      helloSuccesses: diagnostics.helloSuccesses,
      pendingConnections: pendingConnections.size,
      lastHelloRejection: diagnostics.lastHelloRejection
        ? { ...diagnostics.lastHelloRejection, details: { ...(diagnostics.lastHelloRejection.details || {}) } }
        : null,
    };
  }

  function getActiveClientDescriptor() {
    if (!activeClient) return null;
    return {
      connectionId: activeClient.connectionId,
      extensionInstanceId: activeClient.extensionInstanceId,
      extensionId: activeClient.extensionId,
      version: activeClient.version,
      profileLabel: activeClient.profileLabel,
      browserName: activeClient.browserName,
      capabilities: { ...(activeClient.capabilities || {}) },
      connectedAt: activeClient.connectedAt,
      authenticatedAt: activeClient.authenticatedAt,
      origin: activeClient.origin,
    };
  }

  return {
    start,
    stop,
    waitForConnection,
    getStatus,
    getDiagnostics,
    getActiveClientDescriptor,
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
  DEFAULT_HELLO_TIMEOUT_MS,
  LOCAL_BIND_HOST,
  REMOTE_BIND_HOST,
  HELLO_ERROR_TOKEN_MISMATCH,
  HELLO_ERROR_INVALID_PAYLOAD,
  HELLO_ERROR_TIMEOUT,
  HELLO_ERROR_VERSION_UNSUPPORTED,
  createReadableBridgeError,
  createWechatSyncBridgeService,
  isOriginAllowedForWebSocket,
  isRecoverableBridgeConnectionError,
  isUnsupportedBridgeMethodError,
  parseWebSocketFrames,
  retryRecoverableBridgeOperation,
};
