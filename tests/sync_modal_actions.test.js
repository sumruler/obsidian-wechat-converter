import { describe, it, expect, beforeEach, vi } from 'vitest';

function createObsidianLikeElement(tag = 'div') {
  const el = document.createElement(tag);
  el.empty = function empty() {
    this.innerHTML = '';
  };
  el.addClass = function addClass(cls) {
    this.classList.add(cls);
  };
  el.removeClass = function removeClass(cls) {
    this.classList.remove(cls);
  };
  el.setText = function setText(text) {
    this.textContent = text;
  };
  el.createEl = function createEl(childTag, opts = {}) {
    const child = createObsidianLikeElement(childTag);
    if (opts.cls) child.className = opts.cls;
    if (opts.text !== undefined) child.textContent = opts.text;
    if (opts.attr) {
      Object.entries(opts.attr).forEach(([key, value]) => {
        child.setAttribute(key, String(value));
      });
    }
    this.appendChild(child);
    return child;
  };
  el.createDiv = function createDiv(opts = {}) {
    return this.createEl('div', opts);
  };
  return el;
}

function installModalMock(obsidianMock) {
  const openedModals = [];

  class ModalMock {
    constructor(app) {
      this.app = app;
      this.titleEl = createObsidianLikeElement('h2');
      this.contentEl = createObsidianLikeElement('div');
      this.modalEl = createObsidianLikeElement('div');
      openedModals.push(this);
    }

    open() {
      this.isOpen = true;
    }

    close() {
      this.isOpen = false;
    }
  }

  obsidianMock.Modal = ModalMock;
  return {
    getLastModal: () => openedModals[openedModals.length - 1],
  };
}

function findButtonByText(root, text) {
  return Array.from(root.querySelectorAll('button')).find((btn) => btn.textContent === text) || null;
}

describe('AppleStyleView - sync action modal flows', () => {
  let AppleStyleView;
  let view;
  let getLastModal;
  let notices;

  beforeEach(() => {
    vi.resetModules();
    const obsidianMock = require('obsidian');
    ({ getLastModal } = installModalMock(obsidianMock));

    notices = [];
    obsidianMock.Notice = class {
      constructor(message = '', duration = 0) {
        this.message = message;
        this.duration = duration;
        notices.push({ message, duration, instance: this });
      }
      setMessage(message) {
        this.message = message;
      }
      hide() {
        this.hidden = true;
      }
    };

    AppleStyleView = require('../input.js').AppleStyleView;
    view = new AppleStyleView(null, {
      manifest: { id: 'wechat-converter' },
      settings: {},
    });
    view.app = { isMobile: true };
  });

  it('openPluginSettings should return false when app.setting api is unavailable', () => {
    view.app = {};

    const opened = view.openPluginSettings();

    expect(opened).toBe(false);
  });

  it('showAccountSetupEmptyState should fallback to notice when config action cannot open settings', () => {
    vi.spyOn(view, 'openPluginSettings').mockReturnValue(false);

    view.showAccountSetupEmptyState();

    const modal = getLastModal();
    const configBtn = findButtonByText(modal.contentEl, '去配置账号');
    expect(configBtn).not.toBeNull();

    configBtn.onclick();

    expect(notices.length).toBeGreaterThan(0);
    expect(notices[notices.length - 1].message).toContain('请在设置中打开 Obsidian 发布助手并配置公众号账号');
  });

  it('showSyncFailureActions should trigger retry callback when user clicks retry', async () => {
    const retrySpy = vi.spyOn(view, 'onSyncToWechat').mockResolvedValue(undefined);

    view.showSyncFailureActions('network error');

    const modal = getLastModal();
    const retryBtn = findButtonByText(modal.contentEl, '重试同步');
    expect(retryBtn).not.toBeNull();

    await retryBtn.onclick();

    expect(retrySpy).toHaveBeenCalledTimes(1);
  });

  it('showSyncFailureActions should fallback to notice when settings action cannot open settings', () => {
    vi.spyOn(view, 'openPluginSettings').mockReturnValue(false);

    view.showSyncFailureActions('network error');

    const modal = getLastModal();
    const settingsBtn = findButtonByText(modal.contentEl, '去配置账号');
    expect(settingsBtn).not.toBeNull();

    settingsBtn.onclick();

    expect(notices.length).toBeGreaterThan(0);
    expect(notices[notices.length - 1].message).toContain('请在设置中打开 Obsidian 发布助手并配置公众号账号');
  });
});
