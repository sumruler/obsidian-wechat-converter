// tests/settings_ui_smoke.test.js
//
// Smoke test for AppleStyleSettingTab.display(). Goal: any future refactor
// that accidentally drops a Setting from the wechat tab or the multi-platform
// tab will be caught here. This was motivated by commit d115abd silently
// dropping「使用系统回收站」and「API 代理地址」when refactoring 高级设置 into the
// wechat tab — neither change had a test, so the regression went unnoticed.
//
// Invariant: when the test fails, fix the SettingTab UI, not the test —
// unless the field has been intentionally retired.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { createObsidianLikeElement } = require('./helpers/obsidian-dom.js');
const { AppleStyleSettingTab } = require('../input.js');

function makeMinimalSettings(overrides = {}) {
  return {
    theme: 'github',
    themeColor: 'blue',
    customColor: '#0366d6',
    quoteCalloutStyleMode: 'theme',
    fontFamily: 'sans-serif',
    fontSize: 3,
    macCodeBlock: true,
    codeLineNumber: true,
    avatarUrl: '',
    avatarBase64: '',
    enableWatermark: false,
    showImageCaption: true,
    normalizeChinesePunctuation: true,
    wechatAccounts: [],
    defaultAccountId: '',
    proxyUrl: '',
    usePhoneFrame: true,
    sidePadding: 16,
    coloredHeader: false,
    cleanupAfterSync: false,
    cleanupUseSystemTrash: true,
    cleanupDirTemplate: '',
    multiPlatformSync: {
      enabled: true,
      port: 9527,
      token: '',
      supportedPlatforms: [],
      selectedPlatforms: [],
      connection: {
        status: 'untested',
        checkedAt: 0,
        platforms: [],
        capabilities: {},
        message: '',
      },
      recentTasks: [],
    },
    wechatAppId: '',
    wechatAppSecret: '',
    ai: {
      enabled: false,
      providers: [],
      defaultProviderId: '',
      defaultLayoutFamily: 'auto',
      defaultColorPalette: 'auto',
      includeImagesInLayout: true,
      requestTimeoutMs: 45000,
      articleLayoutsByPath: {},
    },
    ...overrides,
  };
}

function makePlugin(settingsOverrides = {}) {
  return {
    app: {},
    manifest: { dir: '/test', id: 'wechat-converter', version: '0.0.0-test' },
    settings: makeMinimalSettings(settingsOverrides),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    startWechatSyncBridgeInBackground: vi.fn(),
    _wechatSyncBridgeService: null,
    getWechatSyncBridgeService: vi.fn(() => ({
      start: vi.fn().mockResolvedValue({}),
      waitForConnection: vi.fn().mockResolvedValue(undefined),
      health: vi.fn().mockResolvedValue({ ok: true, tokenValid: true }),
      listSupportedPlatforms: vi.fn().mockResolvedValue([]),
      getAuthSnapshot: vi.fn().mockResolvedValue({ platforms: [], checkedAt: 0 }),
      checkAuth: vi.fn().mockResolvedValue([]),
      getStatus: vi.fn().mockResolvedValue({}),
    })),
    getConverterView: vi.fn(() => null),
    getArticleLayoutState: vi.fn(() => null),
  };
}

function renderTab(plugin) {
  const tab = new AppleStyleSettingTab(plugin.app, plugin);
  tab.containerEl = createObsidianLikeElement('div');
  tab.display();
  return tab;
}

describe('AppleStyleSettingTab.display - smoke test', () => {
  beforeEach(() => {
    globalThis.__obsidianSettingNamesRegistry = [];
    globalThis.__obsidianButtonRegistry = [];
  });

  it('loads via the resolver patch (sanity check)', () => {
    expect(globalThis.__obsidianMockLoaded).toBe(true);
  });

  it('renders the wechat-tab core sections without throwing', () => {
    const plugin = makePlugin();
    expect(() => renderTab(plugin)).not.toThrow();
    expect(globalThis.__obsidianSettingNamesRegistry.length).toBeGreaterThan(5);
  });

  it('keeps 高级设置 fields that earlier refactors silently dropped', () => {
    // Regression guard for commit d115abd. If you remove either of these,
    // either restore them (recommended) or update this test deliberately.
    renderTab(makePlugin());
    const names = globalThis.__obsidianSettingNamesRegistry;
    expect(names).toContain('发送成功后自动清理资源');
    expect(names).toContain('清理目录');
    expect(names).toContain('使用系统回收站');
    expect(names).toContain('API 代理地址');
  });

  it('renders the preview / watermark headings on the wechat tab', () => {
    renderTab(makePlugin());
    const names = globalThis.__obsidianSettingNamesRegistry;
    expect(names).toContain('预览模式');
    expect(names).toContain('使用手机仿真框');
    expect(names).toContain('图片水印');
  });

  it('renders the multi-platform tab core fields when bridge is enabled', () => {
    renderTab(makePlugin({ multiPlatformSync: {
      enabled: true,
      port: 9527,
      token: '',
      supportedPlatforms: [],
      selectedPlatforms: [],
      connection: { status: 'untested', checkedAt: 0, platforms: [], capabilities: {}, message: '' },
      recentTasks: [],
    } }));
    const names = globalThis.__obsidianSettingNamesRegistry;
    expect(names).toContain('启用浏览器插件发布');
    expect(names).toContain('本地服务端口');
    expect(names).toContain('连接令牌');
    expect(names).toContain('测试连接');
    expect(names).toContain('读取已选平台状态');
  });

  it('testing the bridge connection does not read or refresh platform auth state', async () => {
    const bridge = {
      start: vi.fn().mockResolvedValue({}),
      waitForConnection: vi.fn().mockResolvedValue(undefined),
      health: vi.fn().mockResolvedValue({ ok: true, tokenValid: true, capabilities: {} }),
      listSupportedPlatforms: vi.fn().mockResolvedValue([
        { id: 'zhihu', name: '知乎' },
        { id: 'juejin', name: '掘金' },
      ]),
      getAuthSnapshot: vi.fn().mockResolvedValue({ platforms: [], checkedAt: 0 }),
      checkAuth: vi.fn().mockResolvedValue([]),
      getStatus: vi.fn().mockResolvedValue({}),
    };
    const plugin = makePlugin({
      multiPlatformSync: {
        enabled: true,
        port: 9527,
        token: 'token',
        supportedPlatforms: [],
        selectedPlatforms: ['zhihu'],
        connection: {
          status: 'connected',
          checkedAt: 123,
          platforms: [
            { id: 'zhihu', name: '知乎', authKnown: true, authenticated: true, username: 'Lin' },
          ],
          capabilities: {},
          message: '',
        },
        recentTasks: [],
      },
    });
    plugin.getWechatSyncBridgeService = vi.fn(() => bridge);

    renderTab(plugin);
    const testButton = globalThis.__obsidianButtonRegistry.find((button) => button.text === '测试');
    expect(testButton).toBeDefined();

    await testButton.clickHandler();

    expect(bridge.health).toHaveBeenCalled();
    expect(bridge.listSupportedPlatforms).toHaveBeenCalled();
    expect(bridge.getAuthSnapshot).not.toHaveBeenCalled();
    expect(bridge.checkAuth).not.toHaveBeenCalled();
    expect(plugin.settings.multiPlatformSync.connection.platforms).toEqual([
      expect.objectContaining({ id: 'zhihu', authenticated: true, username: 'Lin' }),
    ]);
    expect(plugin.settings.multiPlatformSync.connection.message).toContain('未读取平台登录状态');
  });

  it('reads cached selected platform auth state without running a live auth check', async () => {
    const bridge = {
      start: vi.fn().mockResolvedValue({}),
      waitForConnection: vi.fn().mockResolvedValue(undefined),
      health: vi.fn().mockResolvedValue({ ok: true, tokenValid: true, capabilities: {} }),
      listSupportedPlatforms: vi.fn().mockResolvedValue([]),
      getAuthSnapshot: vi.fn().mockResolvedValue({
        checkedAt: 456,
        platforms: [
          { id: 'zhihu', name: '知乎', authKnown: true, authenticated: true, username: 'Lin' },
        ],
      }),
      checkAuth: vi.fn().mockResolvedValue([]),
      getStatus: vi.fn().mockResolvedValue({}),
    };
    const plugin = makePlugin({
      multiPlatformSync: {
        enabled: true,
        port: 9527,
        token: 'token',
        supportedPlatforms: [{ id: 'zhihu', name: '知乎' }],
        selectedPlatforms: ['zhihu'],
        connection: {
          status: 'connected',
          checkedAt: 123,
          platforms: [],
          capabilities: {},
          message: '',
        },
        recentTasks: [],
      },
    });
    plugin.getWechatSyncBridgeService = vi.fn(() => bridge);

    renderTab(plugin);
    const readButton = globalThis.__obsidianButtonRegistry.find((button) => button.text === '读取');
    expect(readButton).toBeDefined();

    await readButton.clickHandler();

    expect(bridge.getAuthSnapshot).toHaveBeenCalledWith({
      platforms: ['zhihu'],
      maxAgeMs: 86400000,
      timeoutMs: 5000,
    });
    expect(bridge.checkAuth).not.toHaveBeenCalled();
    expect(plugin.settings.multiPlatformSync.connection.platforms).toEqual([
      expect.objectContaining({ id: 'zhihu', authenticated: true, username: 'Lin' }),
    ]);
    expect(plugin.settings.multiPlatformSync.connection.message).toContain('已读取所选平台的上次登录状态');
  });

  it('unified status bar shows 「连接失败」 and error message when connection.status is failed', () => {
    const tab = renderTab(makePlugin({ multiPlatformSync: {
      enabled: true,
      port: 9527,
      token: 'abc',
      connectedClients: [],
      supportedPlatforms: [],
      selectedPlatforms: [],
      connection: {
        status: 'failed',
        checkedAt: Date.now(),
        platforms: [],
        capabilities: {},
        message: '连接令牌校验失败',
      },
      recentTasks: [],
    } }));

    const dot = tab.containerEl.querySelector('.wechat-multiplatform-token-status-dot');
    expect(dot).not.toBeNull();
    expect(dot.classList.contains('is-error')).toBe(true);
    expect(dot.textContent).toBe('连接失败');
    const body = tab.containerEl.querySelector('.wechat-bridge-status-body');
    expect(body.textContent).toContain('连接令牌校验失败');

    // Unified bar must come before the platform picker.
    const unifiedBar = tab.containerEl.querySelector('.wechat-multiplatform-token-status');
    const picker = tab.containerEl.querySelector('.wechat-platform-picker');
    expect(picker).not.toBeNull();
    expect(unifiedBar.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not render the unified status bar or platform section when bridge is disabled', () => {
    const tab = renderTab(makePlugin({ multiPlatformSync: {
      enabled: false,
      port: 9527,
      token: '',
      supportedPlatforms: [],
      selectedPlatforms: [],
      connection: { status: 'untested', checkedAt: 0, platforms: [], capabilities: {}, message: '' },
      recentTasks: [],
    } }));
    expect(tab.containerEl.querySelector('.wechat-multiplatform-token-status')).toBeNull();
    expect(tab.containerEl.querySelector('.wechat-platform-picker')).toBeNull();
  });

  it('hides bridge-config fields and diagnostics when bridge is disabled', () => {
    renderTab(makePlugin({ multiPlatformSync: {
      enabled: false,
      port: 9527,
      token: '',
      supportedPlatforms: [],
      selectedPlatforms: [],
      connection: { status: 'untested', checkedAt: 0, platforms: [], capabilities: {}, message: '' },
      recentTasks: [],
    } }));
    const names = globalThis.__obsidianSettingNamesRegistry;
    expect(names).toContain('启用浏览器插件发布');
    expect(names).not.toContain('本地服务端口');
    expect(names).not.toContain('测试连接');
    expect(names).not.toContain('读取已选平台状态');
  });

  // Sprint 1 §4.1 introduced three visible affordances; later cleanup
  // pruned two of them, leaving the user-facing surface as just the
  // token state badge:
  //   1. "兼容旧版浏览器插件（过渡）" — removed in Sprint 3 (hello is
  //      now the only auth path)
  //   2. "允许远程访问（高级）" — hidden post-Sprint-3 because普通用户
  //      用不上；底层 settings.allowRemote / bridge bind host / cache
  //      key 全部保留，可通过手动编辑 data.json 启用
  //   3. token state badge (未填 / 已填 / 已验证) — kept

  it('does not expose the advanced allowRemote / legacy-compat toggles to ordinary users', () => {
    renderTab(makePlugin({ multiPlatformSync: {
      enabled: true,
      port: 9527,
      token: 'abc',
      allowRemote: false,
      supportedPlatforms: [],
      selectedPlatforms: [],
      connection: { status: 'untested', checkedAt: 0, platforms: [], capabilities: {}, message: '' },
      recentTasks: [],
    } }));
    const names = globalThis.__obsidianSettingNamesRegistry;
    expect(names).not.toContain('允许远程访问（高级）');
    expect(names).not.toContain('兼容旧版浏览器插件（过渡）');
  });

  it('renders the Sprint 1 §4.1 token-state badge in the "未填" state when token is empty', () => {
    const tab = renderTab(makePlugin({ multiPlatformSync: {
      enabled: true,
      port: 9527,
      token: '',
      supportedPlatforms: [],
      selectedPlatforms: [],
      connection: { status: 'untested', checkedAt: 0, platforms: [], capabilities: {}, message: '' },
      recentTasks: [],
    } }));
    const dot = tab.containerEl.querySelector('.wechat-multiplatform-token-status-dot');
    expect(dot).not.toBeNull();
    expect(dot.classList.contains('is-error')).toBe(true);
    expect(dot.textContent).toBe('未填写');
  });

  it('renders the Sprint 1 §4.1 token-state badge in the "已填" state when token is set but unverified', () => {
    const tab = renderTab(makePlugin({ multiPlatformSync: {
      enabled: true,
      port: 9527,
      token: 'abc-xyz',
      supportedPlatforms: [],
      selectedPlatforms: [],
      connection: { status: 'untested', checkedAt: 0, platforms: [], capabilities: {}, message: '' },
      recentTasks: [],
    } }));
    const dot = tab.containerEl.querySelector('.wechat-multiplatform-token-status-dot');
    expect(dot).not.toBeNull();
    expect(dot.classList.contains('is-unknown')).toBe(true);
    expect(dot.textContent).toBe('等待连接');
  });

  it('renders the Sprint 1 §4.1 token-state badge in the "已验证" state when bridge handshake succeeded', () => {
    const tab = renderTab(makePlugin({ multiPlatformSync: {
      enabled: true,
      port: 9527,
      token: 'abc-xyz',
      supportedPlatforms: [],
      selectedPlatforms: [],
      connection: { status: 'connected', checkedAt: Date.now(), platforms: [], capabilities: {}, message: '' },
      recentTasks: [],
    } }));
    const dot = tab.containerEl.querySelector('.wechat-multiplatform-token-status-dot');
    expect(dot).not.toBeNull();
    expect(dot.classList.contains('is-ok')).toBe(true);
    expect(dot.textContent).toBe('已就绪');
  });

  it('§16 Phase 1: 无 connectedClients 且未测试时显示「等待连接」', () => {
    const tab = renderTab(makePlugin({ multiPlatformSync: {
      enabled: true,
      port: 9527,
      token: 'abc',
      connectedClients: [],
      supportedPlatforms: [],
      selectedPlatforms: [],
      connection: { status: 'untested', checkedAt: 0, platforms: [], capabilities: {}, message: '' },
      recentTasks: [],
    } }));
    const dot = tab.containerEl.querySelector('.wechat-multiplatform-token-status-dot');
    expect(dot).not.toBeNull();
    expect(dot.classList.contains('is-unknown')).toBe(true);
    expect(dot.textContent).toBe('等待连接');
  });

  it('§16 Phase 1: 有 profileLabel 时显示 profileLabel（不再叠加 browserName）', () => {
    const tab = renderTab(makePlugin({ multiPlatformSync: {
      enabled: true,
      port: 9527,
      token: 'abc',
      connectedClients: [{
        extensionInstanceId: 'test-instance-id-001',
        browserName: 'chrome',
        profileLabel: '主号',
        capabilities: {},
        extensionVersion: '1.1.4',
        status: 'connected',
        lastSeenAt: Date.now(),
        firstConnectedAt: Date.now() - 5000,
        lastConnectedAt: Date.now(),
      }],
      supportedPlatforms: [],
      selectedPlatforms: [],
      connection: { status: 'connected', checkedAt: Date.now(), platforms: [], capabilities: {}, message: '' },
      recentTasks: [],
    } }));
    const dot = tab.containerEl.querySelector('.wechat-multiplatform-token-status-dot');
    expect(dot).not.toBeNull();
    expect(dot.classList.contains('is-ok')).toBe(true);
    expect(dot.textContent).toBe('已就绪');
    const body = tab.containerEl.querySelector('.wechat-bridge-status-body');
    expect(body).not.toBeNull();
    expect(body.textContent).toContain('主号');
    // Plan B: profileLabel 存在时不再显示 'Chrome'
    expect(body.textContent).not.toContain('Chrome');
    expect(body.querySelector('.wechat-bridge-status-id')).toBeNull();
  });

  it('§16 Phase 1: 无 profileLabel 时降级显示 browserName', () => {
    const tab = renderTab(makePlugin({ multiPlatformSync: {
      enabled: true,
      port: 9527,
      token: 'abc',
      connectedClients: [{
        extensionInstanceId: 'test-instance-id-002',
        browserName: 'chrome',
        profileLabel: '',
        capabilities: {},
        extensionVersion: '1.1.4',
        status: 'connected',
        lastSeenAt: Date.now(),
        firstConnectedAt: Date.now() - 5000,
        lastConnectedAt: Date.now(),
      }],
      supportedPlatforms: [],
      selectedPlatforms: [],
      connection: { status: 'connected', checkedAt: Date.now(), platforms: [], capabilities: {}, message: '' },
      recentTasks: [],
    } }));
    const body = tab.containerEl.querySelector('.wechat-bridge-status-body');
    expect(body).not.toBeNull();
    expect(body.textContent).toContain('Chrome');
  });

  it('§18.7 Plan B: chrome / chromium 走通用 icon（不撒谎为某个特定 fork）', () => {
    const tab = renderTab(makePlugin({ multiPlatformSync: {
      enabled: true,
      port: 9527,
      token: 'abc',
      connectedClients: [{
        extensionInstanceId: 'test-chromium',
        browserName: 'chrome',
        profileLabel: '',
        capabilities: {},
        extensionVersion: '1.1.4',
        status: 'connected',
        lastSeenAt: Date.now(),
        firstConnectedAt: Date.now() - 5000,
        lastConnectedAt: Date.now(),
      }],
      supportedPlatforms: [],
      selectedPlatforms: [],
      connection: { status: 'connected', checkedAt: Date.now(), platforms: [], capabilities: {}, message: '' },
      recentTasks: [],
    } }));
    const body = tab.containerEl.querySelector('.wechat-bridge-status-body');
    expect(body.querySelector('.wechat-bridge-browser-icon')).toBeNull();         // no SVG
    expect(body.querySelector('.wechat-bridge-browser-icon-generic')).not.toBeNull(); // generic span
  });

  it('§18.7 Plan B: opt-in 浏览器（如 edge）保留各自品牌 SVG', () => {
    const tab = renderTab(makePlugin({ multiPlatformSync: {
      enabled: true,
      port: 9527,
      token: 'abc',
      connectedClients: [{
        extensionInstanceId: 'test-edge',
        browserName: 'edge',
        profileLabel: '',
        capabilities: {},
        extensionVersion: '1.1.4',
        status: 'connected',
        lastSeenAt: Date.now(),
        firstConnectedAt: Date.now() - 5000,
        lastConnectedAt: Date.now(),
      }],
      supportedPlatforms: [],
      selectedPlatforms: [],
      connection: { status: 'connected', checkedAt: Date.now(), platforms: [], capabilities: {}, message: '' },
      recentTasks: [],
    } }));
    const body = tab.containerEl.querySelector('.wechat-bridge-status-body');
    expect(body.querySelector('.wechat-bridge-browser-icon')).not.toBeNull();
  });
});
