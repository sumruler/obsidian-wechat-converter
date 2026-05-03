import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import {
  createReadableBridgeError,
  createWechatSyncBridgeService,
} from '../services/wechatsync-bridge.js';

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function connectExtension(port, handler) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.on('message', async (data) => {
    const message = JSON.parse(data.toString());
    const response = await handler(message);
    ws.send(JSON.stringify({ id: message.id, ...response }));
  });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

describe('Wechatsync bridge service', () => {
  const cleanup = [];

  afterEach(async () => {
    while (cleanup.length) {
      const item = cleanup.pop();
      if (item?.stop) await item.stop();
      if (item?.close) item.close();
    }
  });

  it('sends listPlatforms requests to a connected extension client', async () => {
    const port = await getFreePort();
    const service = createWechatSyncBridgeService({
      WebSocketServer,
      http,
      port,
      token: 'secret-token',
      requestTimeoutMs: 1000,
      connectTimeoutMs: 1000,
      idFactory: () => 'req-1',
    });
    cleanup.push(service);
    await service.start();

    const extension = await connectExtension(port, (message) => {
      expect(message).toMatchObject({
        id: 'req-1',
        method: 'listPlatforms',
        token: 'secret-token',
        params: { forceRefresh: true },
      });
      return {
        result: [
          { id: 'zhihu', name: '知乎', authenticated: true },
          { id: 'juejin', name: '掘金', authenticated: false },
        ],
      };
    });
    cleanup.push(extension);

    await service.waitForConnection(1000);
    const platforms = await service.listPlatforms({ forceRefresh: true });

    expect(platforms).toHaveLength(2);
    expect(platforms[0].id).toBe('zhihu');
  });

  it('maps extension token failures to a readable auth error', async () => {
    const port = await getFreePort();
    const service = createWechatSyncBridgeService({
      WebSocketServer,
      http,
      port,
      requestTimeoutMs: 1000,
      connectTimeoutMs: 1000,
    });
    cleanup.push(service);
    await service.start();

    const extension = await connectExtension(port, () => ({
      error: { code: 403, message: 'Invalid or missing token' },
    }));
    cleanup.push(extension);

    await service.waitForConnection(1000);
    await expect(service.listPlatforms()).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });
  });

  it('can forward through an existing primary bridge HTTP API', async () => {
    const port = await getFreePort();
    const primary = createWechatSyncBridgeService({
      WebSocketServer,
      http,
      port,
      token: 'primary-token',
      requestTimeoutMs: 1000,
      connectTimeoutMs: 1000,
    });
    cleanup.push(primary);
    await primary.start();

    const extension = await connectExtension(port, (message) => {
      expect(message.token).toBe('primary-token');
      return { result: [{ id: 'csdn', name: 'CSDN', authenticated: true }] };
    });
    cleanup.push(extension);
    await primary.waitForConnection(1000);

    const secondary = createWechatSyncBridgeService({
      WebSocketServer,
      http,
      port,
      requestTimeoutMs: 1000,
      connectTimeoutMs: 1000,
    });
    cleanup.push(secondary);

    const platforms = await secondary.listPlatforms();

    expect(platforms).toEqual([{ id: 'csdn', name: 'CSDN', authenticated: true }]);
    expect(await secondary.getStatus()).toMatchObject({ mode: 'secondary', connected: true });
  });

  it('recognizes common bridge error messages', () => {
    expect(createReadableBridgeError(new Error('MCP token not configured')).code).toBe('AUTH_FAILED');
    expect(createReadableBridgeError(new Error('Extension not connected')).code).toBe('EXTENSION_NOT_CONNECTED');
  });
});
