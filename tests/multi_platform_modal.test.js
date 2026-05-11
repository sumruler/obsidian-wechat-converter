// tests/multi_platform_modal.test.js
//
// Locks the DOM contract of the「其他平台发布」modal opened via
// AppleStyleView.showMultiPlatformSyncModal(). Mirrors the chip contract
// in tests/settings_platform_chip.test.js: name and status sit inside the
// label as stacked spans, and is-selected toggles correctly.
//
// Failing this test means a refactor changed the publish-modal platform row
// layout; review styles.css `.wechat-multiplatform-platform*` rules before
// adjusting the test.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { AppleStyleView } = require('../input.js');
const obsidian = require('obsidian');
const { __applyExtensions: applyExtensions } = obsidian;

function installModalCapture() {
  const opened = [];
  class CapturingModal {
    constructor(app) {
      this.app = app;
      this.titleEl = applyExtensions(document.createElement('h2'));
      this.contentEl = applyExtensions(document.createElement('div'));
      this.modalEl = applyExtensions(document.createElement('div'));
      opened.push(this);
    }
    open() { this.isOpen = true; }
    close() { this.isOpen = false; }
  }
  obsidian.Modal = CapturingModal;
  return {
    getLastModal: () => opened[opened.length - 1],
    reset: () => { opened.length = 0; },
  };
}

function makeView({ selectedPlatforms = ['zhihu'], cachedPlatforms = null, bridge = null } = {}) {
  const platforms = cachedPlatforms || [
    { id: 'zhihu', name: '知乎', authKnown: true, authenticated: true, username: 'Lin' },
    { id: 'juejin', name: '掘金', authKnown: true, authenticated: false, error: '登录已失效' },
  ];
  const view = new AppleStyleView(null, {
    settings: {
      wechatAccounts: [{ id: 'acc-1', name: '账号1', appId: 'wx1', appSecret: 'sec1' }],
      defaultAccountId: 'acc-1',
      proxyUrl: '',
      multiPlatformSync: {
        enabled: true,
        port: 9527,
        token: 'test-token',
        supportedPlatforms: [],
        selectedPlatforms,
        connection: {
          status: 'connected',
          checkedAt: Date.now(),
          platforms,
          capabilities: {},
          message: '',
        },
        recentTasks: [],
      },
    },
    getWechatSyncBridgeService: vi.fn(() => ({})),
    saveSettings: vi.fn(),
  });
  if (bridge) view.plugin.getWechatSyncBridgeService = vi.fn(() => bridge);
  view.app = { isMobile: false };
  view.currentHtml = '<p>hello</p>';
  view.getPublishContextFile = vi.fn(() => ({ path: 'a.md', basename: 'a' }));
  view.getCurrentExportHtml = vi.fn(() => '<p>hello</p>');
  view.getFrontmatterPublishMeta = vi.fn(() => ({ coverSrc: '' }));
  view.getFirstImageFromArticle = vi.fn(() => '');
  view.prepareHtmlForWechatsyncArticle = vi.fn(async (html) => html);
  view.getWechatsyncTaskSnapshot = vi.fn(async () => null);
  view.showMultiPlatformQuotaBlockedModal = vi.fn();
  return view;
}

function findRow(modal, platformId) {
  return Array.from(modal.contentEl.querySelectorAll('.wechat-multiplatform-platform'))
    .find((row) => row.querySelector(`input[value="${platformId}"]`));
}

describe('AppleStyleView - showMultiPlatformSyncModal platform rows', () => {
  let modalCapture;

  beforeEach(() => {
    modalCapture = installModalCapture();
  });

  it('renders selected rows with name + status both inside the label (stacked)', async () => {
    const view = makeView({ selectedPlatforms: ['zhihu'] });
    await view.showMultiPlatformSyncModal();
    const modal = modalCapture.getLastModal();

    const row = findRow(modal, 'zhihu');
    expect(row).toBeDefined();

    const label = row.querySelector('.wechat-multiplatform-platform-label');
    const name = label && label.querySelector('.wechat-multiplatform-platform-name');
    const status = label && label.querySelector('.wechat-multiplatform-platform-status');

    expect(label).not.toBeNull();
    expect(name).not.toBeNull();
    expect(status).not.toBeNull();
    expect(status.parentElement).toBe(label);
  });

  it('selected row carries is-selected + auth-status class', async () => {
    const view = makeView({ selectedPlatforms: ['zhihu'] });
    await view.showMultiPlatformSyncModal();
    const modal = modalCapture.getLastModal();
    const row = findRow(modal, 'zhihu');
    expect(row.classList.contains('is-selected')).toBe(true);
    expect(row.classList.contains('is-ok')).toBe(true);
  });

  it('login_required row gets is-error class when selected', async () => {
    const view = makeView({ selectedPlatforms: ['juejin'] });
    await view.showMultiPlatformSyncModal();
    const modal = modalCapture.getLastModal();
    const row = findRow(modal, 'juejin');
    expect(row.classList.contains('is-selected')).toBe(true);
    expect(row.classList.contains('is-error')).toBe(true);
  });

  it('toggling checkbox flips is-selected on the row', async () => {
    const view = makeView({ selectedPlatforms: ['zhihu'] });
    await view.showMultiPlatformSyncModal();
    const modal = modalCapture.getLastModal();
    const row = findRow(modal, 'zhihu');
    const checkbox = row.querySelector('input[type="checkbox"]');

    expect(row.classList.contains('is-selected')).toBe(true);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(row.classList.contains('is-selected')).toBe(false);
    expect(row.classList.contains('is-ok')).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(row.classList.contains('is-selected')).toBe(true);
    expect(row.classList.contains('is-ok')).toBe(true);
  });

  it('hides bridge-not-enabled empty state when enabled', async () => {
    const view = makeView({ selectedPlatforms: ['zhihu'] });
    await view.showMultiPlatformSyncModal();
    const modal = modalCapture.getLastModal();
    const empty = modal.contentEl.querySelector('.wechat-sync-empty-state');
    expect(empty).toBeNull();
  });

  it('row exposes a tooltip with full platform name + status when selected', async () => {
    const view = makeView({ selectedPlatforms: ['zhihu'] });
    await view.showMultiPlatformSyncModal();
    const modal = modalCapture.getLastModal();
    const row = findRow(modal, 'zhihu');
    const title = row.getAttribute('title');
    expect(title).toContain('知乎');
    expect(title).toContain('上次可用');
  });

  it('renders exactly one connection status bar (Phase 2 helper) above the platform list', async () => {
    const view = makeView({ selectedPlatforms: ['zhihu'] });
    await view.showMultiPlatformSyncModal();
    const modal = modalCapture.getLastModal();
    const bars = modal.contentEl.querySelectorAll('.wechat-multiplatform-status');
    expect(bars.length).toBe(1);

    const bar = bars[0];
    const dot = bar.querySelector('.wechat-multiplatform-status-dot');
    expect(dot).not.toBeNull();
    expect(dot.classList.contains('is-ok')).toBe(true);

    // Bar must come before the platform list in DOM order.
    const list = modal.contentEl.querySelector('.wechat-multiplatform-list');
    expect(list).not.toBeNull();
    const followers = bar.compareDocumentPosition(list);
    expect(followers & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the free quota hint with a Pro upgrade action', async () => {
    const view = makeView({ selectedPlatforms: ['zhihu'] });
    view.openPublisherProPage = vi.fn();
    await view.showMultiPlatformSyncModal();
    const modal = modalCapture.getLastModal();

    const hint = modal.contentEl.querySelector('.wechat-multiplatform-quota-hint');
    expect(hint).not.toBeNull();
    expect(hint.textContent).toContain('免费版每天 3 个平台额度');
    const upgradeBtn = hint.querySelector('button');
    expect(upgradeBtn.textContent).toBe('升级 Pro');

    upgradeBtn.click();
    expect(view.openPublisherProPage).toHaveBeenCalled();
  });

  it('passes truncate quotaPolicy and shows quota modal when the extension blocks the task', async () => {
    const bridge = {
      health: vi.fn().mockResolvedValue({ ok: true, capabilities: { quotaPolicy: true } }),
      enqueueSyncArticle: vi.fn().mockResolvedValue({
        accepted: false,
        reason: 'daily_limit',
        quotaBlocked: true,
        skippedPlatforms: ['zhihu', 'juejin'],
        message: '免费版今日平台额度不足，明天 0:00 重置，或升级 Pro。',
      }),
    };
    const view = makeView({ selectedPlatforms: ['zhihu', 'juejin'], bridge });
    await view.showMultiPlatformSyncModal();
    const modal = modalCapture.getLastModal();
    const syncBtn = modal.contentEl.querySelector('.wechat-modal-buttons .mod-cta');

    await syncBtn.onclick();

    expect(bridge.enqueueSyncArticle).toHaveBeenCalledWith(expect.objectContaining({
      platforms: ['zhihu', 'juejin'],
      source: 'obsidian',
      quotaPolicy: 'truncate',
    }));
    expect(view.showMultiPlatformQuotaBlockedModal).toHaveBeenCalledWith(expect.objectContaining({
      requestedPlatformIds: ['zhihu', 'juejin'],
      quotaResult: expect.objectContaining({
        accepted: false,
        reason: 'daily_limit',
      }),
    }));
  });

  it('shows skipped platforms in the accepted task modal when quota truncates the request', () => {
    const view = makeView({ selectedPlatforms: ['zhihu', 'juejin'] });
    view.openPublisherProPage = vi.fn();

    view.showWechatsyncEnqueueAcceptedModal({
      syncId: 'sync-1',
      title: 'a',
      platforms: ['zhihu', 'juejin'],
      quotaResult: {
        accepted: true,
        quotaBlocked: true,
        maxPlatforms: 1,
        publishedPlatforms: ['zhihu'],
        skippedPlatforms: ['juejin'],
      },
    });

    const modal = modalCapture.getLastModal();
    expect(modal.titleEl.textContent).toBe('已发送到浏览器插件');
    expect(modal.contentEl.textContent).toContain('已按免费版额度投递');
    expect(modal.contentEl.textContent).toContain('跳过 1 个超出今日额度的平台');
    expect(modal.contentEl.textContent).toContain('掘金');

    const upgradeBtn = Array.from(modal.contentEl.querySelectorAll('button'))
      .find((button) => button.textContent === '升级 Pro');
    expect(upgradeBtn).toBeDefined();
    upgradeBtn.click();
    expect(view.openPublisherProPage).toHaveBeenCalled();
  });

  it('does not render skipped platforms again as queued task rows', () => {
    const view = makeView({ selectedPlatforms: ['zhihu', 'juejin'] });

    view.showWechatsyncEnqueueAcceptedModal({
      syncId: 'sync-1',
      title: 'a',
      platforms: ['zhihu', 'juejin'],
      task: {
        platforms: [
          { id: 'zhihu', status: 'queued' },
          { id: 'juejin', status: 'queued', message: '免费版今日平台额度不足' },
        ],
      },
      quotaResult: {
        accepted: true,
        quotaBlocked: true,
        maxPlatforms: 1,
        publishedPlatforms: ['zhihu'],
        skippedPlatforms: ['juejin'],
      },
    });

    const modal = modalCapture.getLastModal();
    const rows = Array.from(modal.contentEl.querySelectorAll('.wechat-multiplatform-result-row'));
    const platformRows = rows.filter((row) => row.querySelector('.wechat-multiplatform-result-name')?.textContent !== 'a');
    const zhihuRows = platformRows.filter((row) => row.querySelector('.wechat-multiplatform-result-name')?.textContent === '知乎');
    const juejinRows = platformRows.filter((row) => row.querySelector('.wechat-multiplatform-result-name')?.textContent === '掘金');

    expect(zhihuRows).toHaveLength(1);
    expect(zhihuRows[0].querySelector('.wechat-multiplatform-result-pill')?.textContent).toBe('已投递');
    expect(juejinRows).toHaveLength(1);
    expect(juejinRows[0].querySelector('.wechat-multiplatform-result-pill')?.textContent).toBe('已跳过');
  });

  it('uses daily platform quota copy for legacy platform_limit blocks', () => {
    const view = makeView({ selectedPlatforms: ['zhihu', 'juejin'] });
    view.showMultiPlatformQuotaBlockedModal = AppleStyleView.prototype.showMultiPlatformQuotaBlockedModal.bind(view);

    view.showMultiPlatformQuotaBlockedModal({
      requestedPlatformIds: ['zhihu', 'juejin'],
      quotaResult: {
        accepted: false,
        quotaBlocked: true,
        reason: 'platform_limit',
        maxPlatforms: 3,
        skippedPlatforms: ['zhihu', 'juejin'],
        message: '免费版每次最多 3 个平台。',
      },
    });

    const modal = modalCapture.getLastModal();
    expect(modal.titleEl.textContent).toBe('发布受限');
    expect(modal.contentEl.textContent).toContain('免费版平台额度不足');
    expect(modal.contentEl.textContent).toContain('免费版今日平台额度不足');
    expect(modal.contentEl.textContent).not.toContain('每次最多');
    expect(modal.contentEl.textContent).not.toContain('单次最多');
  });
});
