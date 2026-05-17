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

  it('renders the Phase 2 connection status bar above the platform picker when bridge is enabled', () => {
    const tab = renderTab(makePlugin({ multiPlatformSync: {
      enabled: true,
      port: 9527,
      token: '',
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

    const bar = tab.containerEl.querySelector('.wechat-multiplatform-status');
    expect(bar).not.toBeNull();
    const dot = bar.querySelector('.wechat-multiplatform-status-dot');
    expect(dot.classList.contains('is-error')).toBe(true);
    expect(bar.querySelector('.wechat-multiplatform-status-text').textContent)
      .toContain('连接令牌校验失败');

    // Bar must come before the platform picker.
    const picker = tab.containerEl.querySelector('.wechat-platform-picker');
    expect(picker).not.toBeNull();
    expect(bar.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not render the connection status bar when bridge is disabled', () => {
    const tab = renderTab(makePlugin({ multiPlatformSync: {
      enabled: false,
      port: 9527,
      token: '',
      supportedPlatforms: [],
      selectedPlatforms: [],
      connection: { status: 'untested', checkedAt: 0, platforms: [], capabilities: {}, message: '' },
      recentTasks: [],
    } }));
    expect(tab.containerEl.querySelector('.wechat-multiplatform-status')).toBeNull();
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

  // Sprint 1 §4.1: settings UI introduces three new visible affordances:
  //   1. token state badge (未填 / 已填 / 已验证)
  //   2. "允许远程访问（高级）" toggle controlling bind host
  //   3. "兼容旧版浏览器插件（过渡）" toggle for the Sprint 1 → Sprint 3 window
  // These tests pin the names + state badge so future refactors can't silently
  // drop them.

  it('renders Sprint 1 §3.5 / §3.1 advanced toggles when bridge is enabled', () => {
    renderTab(makePlugin({ multiPlatformSync: {
      enabled: true,
      port: 9527,
      token: 'abc',
      allowRemote: false,
      allowLegacyUnauthenticated: false,
      supportedPlatforms: [],
      selectedPlatforms: [],
      connection: { status: 'untested', checkedAt: 0, platforms: [], capabilities: {}, message: '' },
      recentTasks: [],
    } }));
    const names = globalThis.__obsidianSettingNamesRegistry;
    expect(names).toContain('允许远程访问（高级）');
    expect(names).toContain('兼容旧版浏览器插件（过渡）');
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
    expect(dot.textContent).toBe('未填');
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
    expect(dot.textContent).toBe('已填');
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
    expect(dot.textContent).toBe('已验证');
  });
});
