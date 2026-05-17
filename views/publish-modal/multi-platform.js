// views/publish-modal/multi-platform.js
//
// Renders the「其他平台发布」publish modal. Extracted from input.js
// (originally AppleStyleView.showMultiPlatformSyncModal, ~318 lines).
//
// Public API:
//   showMultiPlatformPublishModal(view, options)
// where `view` is the AppleStyleView instance. The function still relies
// heavily on view.* methods for content preparation (prepareHtmlForWechatsyncArticle,
// getPublishContextFile, getFrontmatterPublishMeta, etc.) and for
// follow-up modals (showWechatsyncEnqueueAcceptedModal, showMultiPlatformSyncResultModal),
// so the view stays the orchestrator — this module only owns the UI shell.

// NOTE: Modal is read lazily inside the function (not destructured at the
// top) so that test code which monkey-patches `obsidian.Modal` after this
// module is required (see tests/multi_platform_modal.test.js) takes effect.
const obsidian = require('obsidian');
const { Notice, Platform } = obsidian;

const {
  isWechatSyncConnectionFailure,
  getWechatsyncPlatformStatusBadge,
  normalizeWechatSyncResponseResults,
  normalizeWechatsyncPlatform,
  summarizeWechatsyncPlatformResponse,
  updateCachedPlatformsAfterSync,
} = require('../../services/wechatsync-results');

const {
  isUnsupportedBridgeMethodError: isWechatSyncUnsupportedMethodError,
} = require('../../services/wechatsync-bridge');

const {
  getAvailableWechatsyncPlatforms,
  normalizeWechatSyncCapabilities,
  normalizeMultiPlatformConnection,
  normalizeMultiPlatformSyncSettings,
  normalizeWechatSyncRecentTasks,
  parseWechatsyncPlatformIds,
} = require('../../services/wechatsync-settings');

const {
  describeWechatsyncConnectionState,
  renderWechatsyncConnectionStatusBar,
} = require('../connection-status-bar.js');

const { stripMarkdownFrontmatter } = require('../../services/markdown-utils');
const {
  formatArticleImageWarnings,
  replaceArticleContentImageSources,
  resolveArticleImages,
} = require('../../services/article-image-assets');

const QUOTA_POLICY = 'truncate';
const FREE_DAILY_PLATFORM_QUOTA = 3;
const MODAL_SELECTED_PLATFORM_IDS = '__wechatMultiPlatformSelectedPlatformIds';

function getQuotaHintText(selectedCount = 0) {
  if (selectedCount > FREE_DAILY_PLATFORM_QUOTA) {
    return `已选 ${selectedCount} 个平台；免费版每天 ${FREE_DAILY_PLATFORM_QUOTA} 个平台额度，超出部分会自动跳过。`;
  }
  if (selectedCount === FREE_DAILY_PLATFORM_QUOTA) {
    return `已选 ${selectedCount} 个平台，刚好达到免费版每天 ${FREE_DAILY_PLATFORM_QUOTA} 个平台额度。`;
  }
  if (selectedCount > 0) {
    return `已选 ${selectedCount} 个平台；免费版每天 ${FREE_DAILY_PLATFORM_QUOTA} 个平台额度。`;
  }
  return `免费版每天 ${FREE_DAILY_PLATFORM_QUOTA} 个平台额度。`;
}

function isMobileClient(app) {
  if (typeof Platform?.isMobile === 'boolean') return Platform.isMobile;
  return !!app?.isMobile;
}

function openPublisherProPage(view) {
  if (typeof view?.openPublisherProPage === 'function') return view.openPublisherProPage();
  if (typeof view?.openExternalUrl === 'function') {
    return view.openExternalUrl('https://xiaoweibox.top/obsidian-publisher/pro/');
  }
  return false;
}

function openPublisherGuidePage(view, section = 'install-extension') {
  if (typeof view?.openPublisherGuidePage === 'function') {
    return view.openPublisherGuidePage(section);
  }
  if (typeof view?.openExternalUrl === 'function') {
    const hash = section === 'bridge' ? 'bridge' : 'install-extension';
    return view.openExternalUrl(`https://xiaoweibox.top/obsidian-publisher/guide/?from=obsidian-plugin#${hash}`);
  }
  return false;
}

function getBridgeSafeSessionCover(cover) {
  const value = String(cover || '').trim();
  if (/^(data:image\/|https?:\/\/)/i.test(value)) return value;
  return '';
}

function getModalSelectedPlatformIds(modal, defaultSelectedPlatforms) {
  if (!Array.isArray(modal?.[MODAL_SELECTED_PLATFORM_IDS])) {
    modal[MODAL_SELECTED_PLATFORM_IDS] = Array.from(defaultSelectedPlatforms);
  }
  return new Set(parseWechatsyncPlatformIds(modal[MODAL_SELECTED_PLATFORM_IDS]));
}

function saveModalSelectedPlatformIds(modal, selectedPlatforms) {
  if (!modal) return;
  modal[MODAL_SELECTED_PLATFORM_IDS] = Array.from(selectedPlatforms);
}

async function detectQuotaPolicySupport(bridge, cachedConnection = {}) {
  const cachedCapabilities = normalizeWechatSyncCapabilities(cachedConnection.capabilities || {});
  if (cachedCapabilities.quotaPolicy === true) return cachedCapabilities;
  if (!bridge || typeof bridge.health !== 'function') return cachedCapabilities;

  try {
    const health = await bridge.health({ timeoutMs: 5000 });
    return {
      ...cachedCapabilities,
      ...normalizeWechatSyncCapabilities(health?.capabilities || {}),
    };
  } catch (error) {
    if (isWechatSyncUnsupportedMethodError(error)) return cachedCapabilities;
    console.debug?.('[Wechatsync] quota feature detection skipped', {
      code: error?.code,
      message: error?.message || String(error),
    });
    return cachedCapabilities;
  }
}

async function showMultiPlatformPublishModal(view, options = {}) {
  if (!view.currentHtml) {
    new Notice(view.getMissingRenderNotice());
    return;
  }

  const modal = options.modal || new obsidian.Modal(view.app);
  const shouldOpenModal = !options.modal;
  const mobileSync = isMobileClient(view.app);
  const bridgeSettings = normalizeMultiPlatformSyncSettings(view.plugin.settings.multiPlatformSync);
  const cachedConnection = bridgeSettings.connection || normalizeMultiPlatformConnection();
  view.preparePublishModalShell(modal, { mode: 'multi', mobileSync });

  const { wechatTab } = view.createPublishModeTabs(modal, 'multi');
  wechatTab.onclick = () => {
    view.showSyncModal({ modal });
  };

  const intro = modal.contentEl.createDiv({ cls: 'wechat-multiplatform-intro' });
  const introText = intro.createDiv({ cls: 'wechat-multiplatform-intro-text' });
  introText.createEl('p', {
    text: '选择平台后通过浏览器插件保存为草稿。',
  });
  const quotaHint = modal.contentEl.createDiv({ cls: 'wechat-multiplatform-quota-hint' });
  const quotaText = quotaHint.createEl('span', {
    text: getQuotaHintText(0),
  });
  const quotaUpgradeBtn = quotaHint.createEl('button', {
    text: '升级 Pro',
    cls: 'wechat-multiplatform-quota-link',
  });
  quotaUpgradeBtn.onclick = () => openPublisherProPage(view);

  if (!bridgeSettings.enabled) {
    const disabledHint = modal.contentEl.createDiv({ cls: 'wechat-sync-empty-state' });
    disabledHint.createEl('h3', { text: '尚未启用浏览器插件发布' });
    disabledHint.createEl('p', { text: '请先安装浏览器插件，再到设置中启用浏览器插件发布、测试连接并选择平台。免费版每天可发布到 3 个平台。' });
    const settingsBtn = disabledHint.createEl('button', { text: '去设置', cls: 'mod-cta' });
    settingsBtn.onclick = () => {
      modal.close();
      if (!view.openPluginSettings()) {
        new Notice('请在设置中打开 Obsidian 发布助手并开启浏览器插件发布');
      }
    };
    const guideBtn = disabledHint.createEl('button', { text: '安装浏览器插件教程' });
    guideBtn.onclick = () => openPublisherGuidePage(view, 'install-extension');
    if (shouldOpenModal) modal.open();
    return;
  }

  const availablePlatforms = getAvailableWechatsyncPlatforms(bridgeSettings);
  const defaultSelectedPlatforms = new Set(
    parseWechatsyncPlatformIds(bridgeSettings.selectedPlatforms || [])
  );
  // 只显示插件设置中已勾选的平台
  const displayedPlatforms = availablePlatforms.filter((p) => defaultSelectedPlatforms.has(p.id));
  const isBridgeReady = cachedConnection.status === 'connected';
  const modalSelectedPlatforms = getModalSelectedPlatformIds(modal, defaultSelectedPlatforms);

  {
    const description = describeWechatsyncConnectionState(cachedConnection, { variant: 'modal' });
    renderWechatsyncConnectionStatusBar(modal.contentEl, description);
  }
  const platformListEl = modal.contentEl.createDiv({ cls: 'wechat-multiplatform-list' });
  const selectedPlatforms = new Set();
  console.debug('[Wechatsync] render cached platform state', {
    status: cachedConnection.status,
    checkedAt: cachedConnection.checkedAt,
    message: cachedConnection.message,
    ...summarizeWechatsyncPlatformResponse(cachedConnection.platforms),
  });

  const btnRow = modal.contentEl.createDiv({ cls: 'wechat-modal-buttons' });
  const cancelBtn = btnRow.createEl('button', { text: '取消' });
  const syncBtn = btnRow.createEl('button', { text: '发送到浏览器插件', cls: 'mod-cta' });
  syncBtn.disabled = true;
  syncBtn.addClass?.('apple-btn-disabled');
  cancelBtn.onclick = () => modal.close();

  const updateQuotaHintText = () => {
    quotaText.textContent = getQuotaHintText(selectedPlatforms.size);
  };

  const updateSyncButtonState = () => {
    syncBtn.disabled = !isBridgeReady || selectedPlatforms.size === 0;
    if (syncBtn.disabled) {
      syncBtn.addClass?.('apple-btn-disabled');
    } else {
      syncBtn.removeClass?.('apple-btn-disabled');
    }
    updateQuotaHintText();
  };

  const renderPlatforms = (platforms = []) => {
    platformListEl.empty();
    selectedPlatforms.clear();
    const normalizedPlatforms = platforms
      .map((platform) => normalizeWechatsyncPlatform(platform))
      .filter(Boolean);

    if (normalizedPlatforms.length === 0) {
      const empty = platformListEl.createDiv({ cls: 'wechat-multiplatform-state' });
      empty.createEl('div', { text: '还没有可分发的平台', cls: 'wechat-multiplatform-state-title' });
      empty.createEl('p', { text: '请先连接浏览器插件，或稍后重试读取平台清单。' });
      updateSyncButtonState();
      return;
    }

    for (const platform of normalizedPlatforms) {
      const authInfo = getWechatsyncPlatformStatusBadge(platform, { bridgeConnected: isBridgeReady });
      const isSelected = isBridgeReady && modalSelectedPlatforms.has(platform.id);
      const row = platformListEl.createDiv({
        cls: `wechat-multiplatform-platform ${isSelected ? `${authInfo.cls} is-selected` : ''}`,
      });
      row.setAttribute('title', isSelected ? `${platform.name} · ${authInfo.text}` : platform.name);
      const checkbox = row.createEl('input');
      checkbox.type = 'checkbox';
      checkbox.value = platform.id;
      checkbox.checked = isSelected;
      checkbox.disabled = !isBridgeReady;
      if (isSelected) selectedPlatforms.add(platform.id);
      const label = row.createEl('label', { cls: 'wechat-multiplatform-platform-label' });
      label.createEl('span', { text: platform.name, cls: 'wechat-multiplatform-platform-name' });
      const statusEl = label.createEl('span', {
        text: authInfo.text,
        cls: `wechat-multiplatform-platform-status ${authInfo.cls}`,
      });
      statusEl.setAttribute('title', authInfo.text);
      const setStatusVisible = (visible) => {
        for (const cls of ['is-ok', 'is-error', 'is-unknown', 'is-bridge']) {
          row.removeClass?.(cls);
          row.classList?.remove(cls);
          statusEl.removeClass?.(cls);
          statusEl.classList?.remove(cls);
        }
        statusEl.textContent = authInfo.text;
        if (visible) {
          row.addClass?.(authInfo.cls);
          row.classList?.add(authInfo.cls);
          statusEl.addClass?.(authInfo.cls);
          statusEl.classList?.add(authInfo.cls);
        }
        row.setAttribute('title', visible ? `${platform.name} · ${authInfo.text}` : platform.name);
      };
      label.onclick = () => {
        if (!checkbox.disabled) checkbox.click();
      };
      checkbox.onchange = () => {
        if (checkbox.checked) {
          selectedPlatforms.add(platform.id);
          row.addClass?.('is-selected');
          row.classList?.add('is-selected');
          setStatusVisible(true);
          if (authInfo.status === 'login_required') {
            new Notice(`${platform.name} 上次状态为需登录。请先在浏览器插件打开平台登录页，或继续尝试由插件返回实际结果。`, 8000);
          }
          if (authInfo.status === 'unknown') {
            new Notice(`${platform.name} 此前未检测，发布结果以浏览器插件实际执行为准。`, 6000);
          }
        } else {
          selectedPlatforms.delete(platform.id);
          row.removeClass?.('is-selected');
          row.classList?.remove('is-selected');
          setStatusVisible(false);
        }
        saveModalSelectedPlatformIds(modal, selectedPlatforms);
        updateSyncButtonState();
      };
    }
    updateSyncButtonState();
  };

  renderPlatforms(displayedPlatforms);

  syncBtn.onclick = async () => {
    if (!isBridgeReady) {
      new Notice('请先连接浏览器插件，再发送多平台发布任务。', 8000);
      return;
    }
    if (selectedPlatforms.size === 0) {
      new Notice('请先选择至少一个平台');
      return;
    }
    const activeFile = view.getPublishContextFile();
    const title = activeFile?.basename || '无标题文章';
    const rawMarkdown = stripMarkdownFrontmatter(view.lastResolvedMarkdown || '');
    const exportHtml = view.getCurrentExportHtml() || view.currentHtml || '';
    const publishMeta = view.getFrontmatterPublishMeta(activeFile);
    const rawCover = getBridgeSafeSessionCover(view.sessionCoverBase64) || publishMeta.cover || '';
    const notice = new Notice('正在准备并发送到浏览器插件...', 0);
    syncBtn.disabled = true;
    syncBtn.addClass?.('apple-btn-disabled');
    const sendStartedAt = Date.now();
    const requestedPlatformIds = Array.from(selectedPlatforms);
    try {
      const resolvedImages = await resolveArticleImages(rawMarkdown, activeFile, {
        app: view.app,
        cover: rawCover,
      });
      if (resolvedImages.warnings?.length) {
        throw new Error(`本地图片处理失败：${formatArticleImageWarnings(resolvedImages.warnings)}`);
      }
      const markdown = resolvedImages.markdown;
      const assets = resolvedImages.assets;
      const fallbackCover = view.getFirstImageFromArticle();
      const cover = resolvedImages.cover
        || resolvedImages.firstImageSrc
        || (/^(https?:\/\/|data:image\/)/i.test(fallbackCover || '') ? fallbackCover : '')
        || '';
      const preparedContent = await view.prepareHtmlForWechatsyncArticle(exportHtml);
      const content = replaceArticleContentImageSources(preparedContent, assets);
      console.info('[Wechatsync] enqueueSyncArticle started', {
        platformCount: requestedPlatformIds.length,
        platforms: requestedPlatformIds,
        title,
        hasMarkdown: !!markdown,
        contentLength: content.length,
        hasCover: !!cover,
        assetCount: assets.length,
        assetBytes: assets.reduce((sum, asset) => sum + (asset.size || 0), 0),
      });
      const bridge = view.plugin.getWechatSyncBridgeService();
      const detectedCapabilities = await detectQuotaPolicySupport(bridge, cachedConnection);
      let result = null;
      let usedFallbackSend = false;
      try {
        result = await bridge.enqueueSyncArticle({
          platforms: requestedPlatformIds,
          title,
          markdown,
          content,
          cover,
          assets,
          source: 'obsidian',
          quotaPolicy: QUOTA_POLICY,
        });
      } catch (enqueueError) {
        if (!isWechatSyncUnsupportedMethodError(enqueueError)) throw enqueueError;
        usedFallbackSend = true;
        console.warn('[Wechatsync] enqueueSyncArticle unsupported, falling back to one-way syncArticle', enqueueError);
        result = await bridge.sendArticle({
          platforms: requestedPlatformIds,
          title,
          markdown,
          content,
          cover,
          assets,
        });
      }
      console.info('[Wechatsync] enqueueSyncArticle accepted', {
        elapsedMs: Date.now() - sendStartedAt,
        resultKind: Array.isArray(result) ? 'array' : typeof result,
        syncId: result?.syncId,
        requestId: result?.requestId,
        accepted: result?.accepted,
        quotaBlocked: result?.quotaBlocked,
        skippedPlatforms: result?.skippedPlatforms,
        usedFallbackSend,
        platformCount: requestedPlatformIds.length,
        supportsQuotaPolicy: detectedCapabilities.quotaPolicy === true,
      });
      const currentMultiPlatformSettings = normalizeMultiPlatformSyncSettings(view.plugin.settings.multiPlatformSync);
      if (result?.accepted === false) {
        notice.hide();
        modal.close();
        view.plugin.settings.multiPlatformSync = normalizeMultiPlatformSyncSettings({
          ...currentMultiPlatformSettings,
          connection: {
            ...currentMultiPlatformSettings.connection,
            status: 'connected',
            checkedAt: Date.now(),
            capabilities: {
              ...(currentMultiPlatformSettings.connection?.capabilities || {}),
              ...detectedCapabilities,
            },
            message: result?.message || '浏览器插件已拒绝本次发布。',
          },
        });
        await view.plugin.saveSettings();
        view.showMultiPlatformQuotaBlockedModal({
          quotaResult: result,
          requestedPlatformIds,
        });
        return;
      }
      if (result?.syncId) notice.setMessage('已投递，正在读取插件任务状态...');
      const taskSnapshot = result?.syncId
        ? await view.getWechatsyncTaskSnapshot(bridge, result.syncId)
        : null;
      const immediateResults = normalizeWechatSyncResponseResults(result);
      const taskResults = Array.isArray(taskSnapshot?.platforms)
        ? taskSnapshot.platforms.map((item) => ({
          platform: item?.id || item?.platform,
          platformName: item?.name,
          success: item?.success === true || item?.status === 'success',
          error: item?.error || item?.message || '',
        }))
        : [];
      const cachedPlatformsAfterSync = updateCachedPlatformsAfterSync(
        currentMultiPlatformSettings.connection?.platforms || [],
        immediateResults.length ? immediateResults : taskResults
      );
      notice.hide();
      modal.close();
      const nextRecentTasks = result?.syncId
        ? normalizeWechatSyncRecentTasks([
          {
            syncId: result.syncId,
            title,
            platforms: Array.isArray(result?.publishedPlatforms) && result.publishedPlatforms.length
              ? result.publishedPlatforms
              : (Array.isArray(result?.platforms) && result.platforms.length ? result.platforms : requestedPlatformIds),
            createdAt: Date.now(),
          },
          ...(currentMultiPlatformSettings.recentTasks || []),
        ])
        : currentMultiPlatformSettings.recentTasks;
      view.plugin.settings.multiPlatformSync = normalizeMultiPlatformSyncSettings({
        ...currentMultiPlatformSettings,
        recentTasks: nextRecentTasks,
        connection: {
          ...currentMultiPlatformSettings.connection,
          status: 'connected',
          checkedAt: Date.now(),
          platforms: cachedPlatformsAfterSync,
          capabilities: {
            ...(currentMultiPlatformSettings.connection?.capabilities || {}),
            ...detectedCapabilities,
          },
          message: '',
        },
      });
      await view.plugin.saveSettings();
      view.showWechatsyncEnqueueAcceptedModal({
        syncId: result?.syncId || '',
        title,
        platforms: requestedPlatformIds,
        task: taskSnapshot,
        usedFallbackSend,
        quotaResult: result,
      });
    } catch (error) {
      notice.hide();
      console.error('[Wechatsync] enqueueSyncArticle failed', {
        elapsedMs: Date.now() - sendStartedAt,
        code: error?.code,
        message: error?.message || String(error),
        stack: error?.stack,
        requestedPlatformIds,
      });
      // §4.1: surface EXTENSION_NOT_AUTHENTICATED with a dedicated message
      // so users know the extension is reachable but failed the handshake,
      // rather than reusing the generic "connection failed" copy.
      const displayMessage = error?.code === 'EXTENSION_NOT_AUTHENTICATED'
        ? '浏览器插件已连接但未通过握手认证。请确认插件已升级到支持安全握手的版本，且使用与 Obsidian 一致的连接令牌。'
        : (error?.message || '浏览器插件连接失败');
      if (isWechatSyncConnectionFailure(error)) {
        const currentMultiPlatformSettings = normalizeMultiPlatformSyncSettings(view.plugin.settings.multiPlatformSync);
        view.plugin.settings.multiPlatformSync = normalizeMultiPlatformSyncSettings({
          ...currentMultiPlatformSettings,
          connection: {
            ...currentMultiPlatformSettings.connection,
            status: 'failed',
            checkedAt: Date.now(),
            message: displayMessage,
          },
        });
        await view.plugin.saveSettings();
      }
      modal.close();
      new Notice(`❌ 发送到浏览器插件失败：${displayMessage}`, 10000);
      view.showMultiPlatformSyncResultModal({
        requestedPlatformIds,
        fatalError: error,
      });
    } finally {
      updateSyncButtonState();
    }
  };

  if (shouldOpenModal) modal.open();
}

module.exports = { showMultiPlatformPublishModal };
