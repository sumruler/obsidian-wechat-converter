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

  it('checks bridge health through the extension so token errors are surfaced', async () => {
    const port = await getFreePort();
    const service = createWechatSyncBridgeService({
      WebSocketServer,
      http,
      port,
      token: 'secret-token',
      requestTimeoutMs: 1000,
      connectTimeoutMs: 1000,
      idFactory: () => 'health-1',
    });
    cleanup.push(service);
    await service.start();

    const extension = await connectExtension(port, (message) => {
      expect(message).toMatchObject({
        id: 'health-1',
        method: 'health',
        token: 'secret-token',
      });
      return {
        result: {
          ok: true,
          extensionConnected: true,
          tokenValid: true,
          version: '2.0.9',
        },
      };
    });
    cleanup.push(extension);

    await service.waitForConnection(1000);
    await expect(service.health()).resolves.toMatchObject({
      ok: true,
      tokenValid: true,
    });
  });

  it('loads supported platform metadata without triggering auth checks', async () => {
    const port = await getFreePort();
    const service = createWechatSyncBridgeService({
      WebSocketServer,
      http,
      port,
      token: 'secret-token',
      requestTimeoutMs: 1000,
      connectTimeoutMs: 1000,
      idFactory: () => 'supported-1',
    });
    cleanup.push(service);
    await service.start();

    const extension = await connectExtension(port, (message) => {
      expect(message).toMatchObject({
        id: 'supported-1',
        method: 'listSupportedPlatforms',
        token: 'secret-token',
      });
      return {
        result: [
          { id: 'zhihu', name: '知乎', supportsDraft: true },
          { id: 'xiaohongshu', name: '小红书', supportsDraft: true },
        ],
      };
    });
    cleanup.push(extension);

    await service.waitForConnection(1000);
    await expect(service.listSupportedPlatforms()).resolves.toEqual([
      { id: 'zhihu', name: '知乎', supportsDraft: true },
      { id: 'xiaohongshu', name: '小红书', supportsDraft: true },
    ]);
  });

  it('can time out platform listing without waiting for the long sync timeout', async () => {
    const port = await getFreePort();
    const service = createWechatSyncBridgeService({
      WebSocketServer,
      http,
      port,
      token: 'secret-token',
      requestTimeoutMs: 1000,
      connectTimeoutMs: 1000,
      idFactory: () => 'slow-list',
    });
    cleanup.push(service);
    await service.start();

    const extension = await connectExtension(port, () => new Promise(() => {}));
    cleanup.push(extension);

    await service.waitForConnection(1000);
    const startedAt = Date.now();
    await expect(service.listPlatforms({ timeoutMs: 20 })).rejects.toMatchObject({
      code: 'PLATFORM_LIST_TIMEOUT',
    });
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('can time out article sync with a readable timeout error', async () => {
    const port = await getFreePort();
    const service = createWechatSyncBridgeService({
      WebSocketServer,
      http,
      port,
      token: 'secret-token',
      requestTimeoutMs: 1000,
      connectTimeoutMs: 1000,
      idFactory: () => 'slow-sync',
    });
    cleanup.push(service);
    await service.start();

    const extension = await connectExtension(port, () => new Promise(() => {}));
    cleanup.push(extension);

    await service.waitForConnection(1000);
    const startedAt = Date.now();
    await expect(service.syncArticle({
      platforms: ['zhihu'],
      title: '测试文章',
      markdown: '# 正文',
      content: '<h1>正文</h1>',
      timeoutMs: 20,
    })).rejects.toMatchObject({
      code: 'SYNC_TIMEOUT',
    });
    expect(Date.now() - startedAt).toBeLessThan(500);
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

  it('passes syncArticle results through with draft URLs and per-platform errors', async () => {
    const port = await getFreePort();
    const service = createWechatSyncBridgeService({
      WebSocketServer,
      http,
      port,
      token: 'secret-token',
      requestTimeoutMs: 1000,
      connectTimeoutMs: 1000,
      idFactory: () => 'sync-1',
    });
    cleanup.push(service);
    await service.start();

    const extension = await connectExtension(port, (message) => {
      expect(message).toMatchObject({
        id: 'sync-1',
        method: 'syncArticle',
        token: 'secret-token',
        params: {
          platforms: ['zhihu', 'juejin'],
          article: {
            title: '测试文章',
            markdown: '# 正文',
            content: '<h1>正文</h1>',
            cover: 'https://example.com/cover.png',
          },
        },
      });
      return {
        result: {
          syncId: 'remote-sync-1',
          results: [
            {
              platform: 'zhihu',
              platformName: '知乎',
              success: true,
              postUrl: 'https://zhuanlan.zhihu.com/p/123/edit',
              draftOnly: true,
            },
            {
              platform: 'juejin',
              platformName: '掘金',
              success: false,
              error: '未登录',
            },
          ],
        },
      };
    });
    cleanup.push(extension);

    await service.waitForConnection(1000);
    const result = await service.syncArticle({
      platforms: ['zhihu', 'juejin'],
      title: '测试文章',
      markdown: '# 正文',
      content: '<h1>正文</h1>',
      cover: 'https://example.com/cover.png',
    });

    expect(result).toEqual({
      syncId: 'remote-sync-1',
      results: [
        {
          platform: 'zhihu',
          platformName: '知乎',
          success: true,
          postUrl: 'https://zhuanlan.zhihu.com/p/123/edit',
          draftOnly: true,
        },
        {
          platform: 'juejin',
          platformName: '掘金',
          success: false,
          error: '未登录',
        },
      ],
    });
  });

  it('can send article to the extension without waiting for sync results', async () => {
    const port = await getFreePort();
    const service = createWechatSyncBridgeService({
      WebSocketServer,
      http,
      port,
      token: 'secret-token',
      requestTimeoutMs: 1000,
      connectTimeoutMs: 1000,
      idFactory: () => 'one-way-sync',
    });
    cleanup.push(service);
    await service.start();

    let resolveReceived;
    const receivedMessage = new Promise((resolve) => {
      resolveReceived = resolve;
    });
    const extension = await connectExtension(port, (message) => {
      resolveReceived(message);
      return new Promise(() => {});
    });
    cleanup.push(extension);

    await service.waitForConnection(1000);
    const startedAt = Date.now();
    const result = await service.sendArticle({
      platforms: ['zhihu'],
      title: '测试文章',
      markdown: '# 正文',
      content: '<h1>正文</h1>',
    });

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(result).toEqual({
      accepted: true,
      requestId: 'one-way-sync',
      method: 'syncArticle',
    });
    await expect(receivedMessage).resolves.toMatchObject({
      id: 'one-way-sync',
      method: 'syncArticle',
      token: 'secret-token',
      params: {
        platforms: ['zhihu'],
        article: {
          title: '测试文章',
          markdown: '# 正文',
          content: '<h1>正文</h1>',
        },
      },
    });
  });

  it('enqueues article sync and returns the extension sync id', async () => {
    const port = await getFreePort();
    const service = createWechatSyncBridgeService({
      WebSocketServer,
      http,
      port,
      token: 'secret-token',
      requestTimeoutMs: 1000,
      connectTimeoutMs: 1000,
      idFactory: () => 'enqueue-1',
    });
    cleanup.push(service);
    await service.start();

    const extension = await connectExtension(port, (message) => {
      expect(message).toMatchObject({
        id: 'enqueue-1',
        method: 'enqueueSyncArticle',
        token: 'secret-token',
        params: {
          platforms: ['zhihu'],
          source: 'obsidian',
          article: {
            title: '测试文章',
            markdown: '# 正文',
            content: '<h1>正文</h1>',
          },
        },
      });
      return {
        result: {
          accepted: true,
          syncId: 'extension-sync-1',
          platforms: ['zhihu'],
        },
      };
    });
    cleanup.push(extension);

    await service.waitForConnection(1000);
    await expect(service.enqueueSyncArticle({
      platforms: ['zhihu'],
      title: '测试文章',
      markdown: '# 正文',
      content: '<h1>正文</h1>',
    })).resolves.toMatchObject({
      accepted: true,
      syncId: 'extension-sync-1',
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
    expect(createReadableBridgeError(new Error('Request timeout: listPlatforms')).code).toBe('PLATFORM_LIST_TIMEOUT');
    expect(createReadableBridgeError(new Error('Request timeout: syncArticle')).code).toBe('SYNC_TIMEOUT');
    expect(createReadableBridgeError(new Error('Request timeout: enqueueSyncArticle')).code).toBe('BRIDGE_REQUEST_TIMEOUT');
  });
});
