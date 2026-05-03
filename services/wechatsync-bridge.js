const DEFAULT_WECHATSYNC_PORT = 9527;
const DEFAULT_REQUEST_TIMEOUT_MS = 360000;
const DEFAULT_CONNECT_TIMEOUT_MS = 60000;

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

  if (!WebSocketServer) {
    throw new Error('WebSocketServer is required to create Wechatsync bridge service.');
  }
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
          const { method, params } = JSON.parse(body || '{}');
          const result = await requestInternal(method, params);
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
        wss = new WebSocketServer({ port });
      } catch (error) {
        reject(error);
        return;
      }

      wss.once('listening', resolve);
      wss.once('error', reject);
      wss.on('connection', (ws) => {
        client = ws;
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
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') {
        throw createReadableBridgeError(error);
      }
      isServerMode = false;
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
    if (!pending) return;

    clearTimeout(pending.timeout);
    pendingRequests.delete(message.id);

    if (message.error) {
      const errorMessage = message.error.message || message.error.error || String(message.error);
      pending.reject(createReadableBridgeError(new Error(errorMessage)));
      return;
    }
    pending.resolve(message.result);
  }

  function requestInternal(method, params) {
    if (!isPrimaryConnected()) {
      return Promise.reject(createReadableBridgeError(new Error('Extension not connected.')));
    }
    if (!method) {
      return Promise.reject(new Error('Wechatsync bridge method is required.'));
    }

    const id = idFactory();
    const message = { id, method, params };
    if (token) message.token = token;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        reject(createReadableBridgeError(new Error(`Request timeout: ${method}`)));
      }, requestTimeoutMs);

      pendingRequests.set(id, { resolve, reject, timeout });
      client.send(JSON.stringify(message));
    });
  }

  function requestViaHttp(method, params) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({ method, params });
      const req = http.request({
        hostname: 'localhost',
        port: port + 1,
        path: '/request',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: requestTimeoutMs,
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
        reject(createReadableBridgeError(new Error(`Request timeout: ${method}`)));
      });
      req.write(data);
      req.end();
    });
  }

  async function request(method, params) {
    await start();
    if (isServerMode) {
      return requestInternal(method, params);
    }
    return requestViaHttp(method, params);
  }

  function listPlatforms({ forceRefresh = false } = {}) {
    return request('listPlatforms', { forceRefresh });
  }

  function checkAuth(platform) {
    return request('checkAuth', { platform });
  }

  function syncArticle({ platforms, title, markdown, content, cover }) {
    return request('syncArticle', {
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
    listPlatforms,
    checkAuth,
    syncArticle,
    _request: request,
  };
}

module.exports = {
  DEFAULT_WECHATSYNC_PORT,
  createReadableBridgeError,
  createWechatSyncBridgeService,
};
