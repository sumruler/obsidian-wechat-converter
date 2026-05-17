// views/settings/multi-platform-tab.js
//
// Renders the「其他平台」settings tab. Extracted from input.js display()
// (originally lines 6088-6521). The tab is one cohesive block:
//   1. enable toggle
//   2. port + token inputs
//   3. persistent connection status bar (Phase 2 helper)
//   4. platform picker grid (chip per platform with auth status)
//   5. 测试连接 button (start bridge + health + listSupportedPlatforms +
//      no platform auth lookup)
//   6. 读取已选平台状态 button (read cached auth snapshot only)
//
// Public API:
//   renderMultiPlatformSettingsTab(tab, containerEl)
// where `tab` is the AppleStyleSettingTab instance, used for accessing
// `tab.plugin.*` and triggering re-renders via `tab.display()`.

const { Setting, Notice } = require('obsidian');

const {
  DEFAULT_WECHATSYNC_PORT,
  retryRecoverableBridgeOperation,
  isUnsupportedBridgeMethodError: isWechatSyncUnsupportedMethodError,
} = require('../../services/wechatsync-bridge');

const {
  getFallbackWechatsyncPlatforms,
  getWechatsyncPlatformStatusBadge,
  normalizeWechatsyncAuthSnapshot,
  normalizeWechatsyncPlatformList,
  summarizeWechatsyncPlatformResponse,
} = require('../../services/wechatsync-results');

const {
  getAvailableWechatsyncPlatforms,
  mergeWechatsyncPlatformLists,
  normalizeMultiPlatformSyncSettings,
  normalizeWechatSyncCapabilities,
  parseWechatsyncPlatformIds,
} = require('../../services/wechatsync-settings');

const {
  describeWechatsyncConnectionState,
  formatWechatsyncCheckedAt,
  renderWechatsyncConnectionStatusBar,
} = require('../connection-status-bar.js');

const OBSIDIAN_PUBLISHER_PRO_URL = 'https://xiaoweibox.top/obsidian-publisher/pro/?from=obsidian-plugin';
const OBSIDIAN_PUBLISHER_EXTENSION_GUIDE_URL = 'https://xiaoweibox.top/obsidian-publisher/guide/?from=obsidian-plugin#install-extension';
const OBSIDIAN_PUBLISHER_BRIDGE_GUIDE_URL = 'https://xiaoweibox.top/obsidian-publisher/guide/?from=obsidian-plugin#bridge';

function openExternalUrl(url) {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) return false;

  try {
    const electron = require('electron');
    if (electron?.shell?.openExternal) {
      electron.shell.openExternal(target);
      return true;
    }
  } catch {
    // Obsidian mobile and some test runtimes do not expose Electron.
  }

  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(target, '_blank', 'noopener');
    return true;
  }

  return false;
}

function renderMultiPlatformSettingsTab(tab, containerEl) {
  const { plugin } = tab;
  const multiPlatformSettings = normalizeMultiPlatformSyncSettings(plugin.settings.multiPlatformSync);
  plugin.settings.multiPlatformSync = multiPlatformSettings;

  new Setting(containerEl)
    .setName('浏览器插件发布')
    .setDesc('Obsidian 负责写作、预览和平台选择；浏览器插件使用当前的浏览器登录态，把文章保存到知乎、掘金、CSDN 等平台草稿箱。微信仍可使用上方公众号 API。')
    .setHeading();

  const guide = containerEl.createDiv({ cls: 'wechat-multiplatform-onboarding' });
  guide.createEl('div', {
    cls: 'wechat-multiplatform-onboarding-title',
    text: '下一步：安装浏览器插件并完成配置',
  });
  guide.createEl('p', {
    text: '免费版每天可发布到 3 个平台。想先试用，先安装浏览器插件；已经购买或已经装好浏览器插件，可直接查看配置步骤。',
  });
  const guideActions = guide.createDiv({ cls: 'wechat-multiplatform-onboarding-actions' });
  const installGuideBtn = guideActions.createEl('button', { text: '安装浏览器插件', cls: 'mod-cta' });
  installGuideBtn.onclick = () => openExternalUrl(OBSIDIAN_PUBLISHER_EXTENSION_GUIDE_URL);
  const bridgeGuideBtn = guideActions.createEl('button', { text: '查看配置步骤' });
  bridgeGuideBtn.onclick = () => openExternalUrl(OBSIDIAN_PUBLISHER_BRIDGE_GUIDE_URL);
  const proGuideBtn = guideActions.createEl('button', { text: '了解 Pro' });
  proGuideBtn.onclick = () => openExternalUrl(OBSIDIAN_PUBLISHER_PRO_URL);

  const tokenIsEmpty = !multiPlatformSettings.token;
  const enableSetting = new Setting(containerEl)
    .setName('启用浏览器插件发布')
    .setDesc(tokenIsEmpty
      ? '请先在下方填入「连接令牌」，否则无法启用浏览器插件发布。'
      : '开启后，Obsidian 会把文章发送给浏览器插件，由插件使用浏览器登录态保存到各平台草稿箱。')
    .addToggle(toggle => toggle
      .setValue(multiPlatformSettings.enabled)
      .setDisabled(tokenIsEmpty)
      .onChange(async (value) => {
        plugin.settings.multiPlatformSync = normalizeMultiPlatformSyncSettings({
          ...plugin.settings.multiPlatformSync,
          enabled: value,
        });
        await plugin.saveSettings();
        if (value) {
          plugin.startWechatSyncBridgeInBackground('settings-enabled');
        } else if (plugin._wechatSyncBridgeService?.stop) {
          await plugin._wechatSyncBridgeService.stop().catch((error) => {
            console.warn('停止浏览器插件连接失败:', error);
          });
        }
        tab.display();
      }));
  if (tokenIsEmpty) {
    enableSetting.descEl?.classList?.add?.('wechat-multiplatform-warning');
  }

  if (!multiPlatformSettings.enabled) {
    return;
  }

  new Setting(containerEl)
    .setName('本地服务端口')
    .setDesc('默认 9527。只有当浏览器插件中的本地服务地址使用了其他端口时才需要修改。')
    .addText(text => text
      .setPlaceholder(String(DEFAULT_WECHATSYNC_PORT))
      .setValue(String(multiPlatformSettings.port))
      .onChange(async (value) => {
        const nextPort = Number(value);
        plugin.settings.multiPlatformSync = normalizeMultiPlatformSyncSettings({
          ...plugin.settings.multiPlatformSync,
          port: Number.isInteger(nextPort) ? nextPort : DEFAULT_WECHATSYNC_PORT,
          connection: { status: 'untested' },
        });
        await plugin.saveSettings();
        plugin.startWechatSyncBridgeInBackground('settings-port-change');
      }));

  new Setting(containerEl)
    .setName('连接令牌')
    .setDesc('填入浏览器插件本地服务中显示的连接令牌，用于确认 Obsidian 与插件属于同一组连接。')
    .addText(text => text
      .setPlaceholder('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')
      .setValue(multiPlatformSettings.token)
      .onChange(async (value) => {
        plugin.settings.multiPlatformSync = normalizeMultiPlatformSyncSettings({
          ...plugin.settings.multiPlatformSync,
          token: value,
          connection: { status: 'untested' },
        });
        await plugin.saveSettings();
        plugin.startWechatSyncBridgeInBackground('settings-token-change');
      }));

  // §4.1: token 状态指示 — 未填 / 已填 / 已验证
  {
    const tokenStatusBar = containerEl.createDiv({ cls: 'wechat-multiplatform-token-status' });
    const dot = tokenStatusBar.createEl('span', { cls: 'wechat-multiplatform-token-status-dot' });
    const text = tokenStatusBar.createEl('span', { cls: 'wechat-multiplatform-token-status-text' });
    if (!multiPlatformSettings.token) {
      dot.classList?.add?.('is-error');
      dot.textContent = '未填';
      text.textContent = '连接令牌尚未填写。请到浏览器插件弹窗复制令牌。';
    } else if (multiPlatformSettings.connection?.status === 'connected') {
      dot.classList?.add?.('is-ok');
      dot.textContent = '已验证';
      text.textContent = '连接令牌已通过浏览器插件握手验证。';
    } else {
      dot.classList?.add?.('is-unknown');
      dot.textContent = '已填';
      text.textContent = '连接令牌已填写但尚未通过握手验证。请点击下方「测试连接」。';
    }
  }

  // §3.5 + §4.1: 「允许远程访问」高级开关（默认关闭，开启时显示红色警告）
  {
    const remoteSetting = new Setting(containerEl)
      .setName('允许远程访问（高级）')
      .setDesc(multiPlatformSettings.allowRemote
        ? '当前监听 0.0.0.0：同网络下的其他设备也能尝试连接，请务必使用强随机连接令牌并保持网络可信。'
        : '默认仅监听 127.0.0.1（本机回环），其他设备无法连接。仅在你完全理解风险时开启。')
      .addToggle(toggle => toggle
        .setValue(multiPlatformSettings.allowRemote)
        .onChange(async (value) => {
          plugin.settings.multiPlatformSync = normalizeMultiPlatformSyncSettings({
            ...plugin.settings.multiPlatformSync,
            allowRemote: value,
            connection: { status: 'untested' },
          });
          await plugin.saveSettings();
          if (plugin._wechatSyncBridgeService?.stop) {
            await plugin._wechatSyncBridgeService.stop().catch(() => {});
          }
          plugin._wechatSyncBridgeService = null;
          plugin._wechatSyncBridgeCacheKey = null;
          plugin.startWechatSyncBridgeInBackground('settings-allow-remote-change');
          tab.display();
        }));
    if (multiPlatformSettings.allowRemote) {
      remoteSetting.descEl?.classList?.add?.('wechat-multiplatform-warning');
    }
  }

  // §3.1 兼容策略：旧版浏览器插件不发 extension_hello 时的过渡开关。
  // 计划文档 §4.3 Sprint 3 完成后会移除此开关。
  {
    const legacySetting = new Setting(containerEl)
      .setName('兼容旧版浏览器插件（过渡）')
      .setDesc(multiPlatformSettings.allowLegacyUnauthenticated
        ? '已允许未经握手的旧版浏览器插件连接。注意：此模式没有 extension_hello 安全验证，相当于回到 Sprint 1 之前的行为，浏览器插件升级后请立即关闭。'
        : '默认关闭。仅在浏览器插件尚未升级到支持安全握手版本时临时开启。Sprint 3 浏览器插件上线后此开关会被移除。')
      .addToggle(toggle => toggle
        .setValue(multiPlatformSettings.allowLegacyUnauthenticated)
        .onChange(async (value) => {
          plugin.settings.multiPlatformSync = normalizeMultiPlatformSyncSettings({
            ...plugin.settings.multiPlatformSync,
            allowLegacyUnauthenticated: value,
            connection: { status: 'untested' },
          });
          await plugin.saveSettings();
          if (plugin._wechatSyncBridgeService?.stop) {
            await plugin._wechatSyncBridgeService.stop().catch(() => {});
          }
          plugin._wechatSyncBridgeService = null;
          plugin._wechatSyncBridgeCacheKey = null;
          plugin.startWechatSyncBridgeInBackground('settings-allow-legacy-change');
          tab.display();
        }));
    if (multiPlatformSettings.allowLegacyUnauthenticated) {
      legacySetting.descEl?.classList?.add?.('wechat-multiplatform-warning');
    }
  }

  const getSupportedPlatformsFromExtension = async (bridge) => {
    const response = await bridge.listSupportedPlatforms({ timeoutMs: 10000 });
    return normalizeWechatsyncPlatformList(response);
  };
  const getAuthSnapshotFromExtension = async (bridge, platforms = [], fallbackPlatforms = []) => {
    const response = await bridge.getAuthSnapshot({
      platforms,
      maxAgeMs: 86400000,
      timeoutMs: 5000,
    });
    return normalizeWechatsyncAuthSnapshot(response, fallbackPlatforms);
  };
  const hasExtensionPlatformList = Array.isArray(multiPlatformSettings.supportedPlatforms)
    && multiPlatformSettings.supportedPlatforms.length > 0
    && multiPlatformSettings.connection?.status === 'connected';
  const availablePlatforms = getAvailableWechatsyncPlatforms(multiPlatformSettings);
  const selectedPlatformSet = new Set(multiPlatformSettings.selectedPlatforms || []);
  const hasCachedAuthState = availablePlatforms.some(
    (platform) => platform.authKnown && platform.authStatus !== 'bridge_required'
  );
  const getPlatformAuthBadge = (platform = {}) => getWechatsyncPlatformStatusBadge(platform, {
    bridgeConnected: multiPlatformSettings.connection?.status === 'connected',
  });

  // Persistent connection status bar above the platform picker. Replaces
  // the previous flow where the only feedback for a failed 测试连接 was
  // a Notice that disappeared after a few seconds. The bar reflects the
  // latest cached connection state and stays visible across re-renders.
  {
    const description = describeWechatsyncConnectionState(
      multiPlatformSettings.connection,
      { variant: 'settings' }
    );
    renderWechatsyncConnectionStatusBar(containerEl, description);
  }

  const platformPicker = containerEl.createDiv({ cls: 'wechat-platform-picker' });
  const platformPickerHeader = platformPicker.createDiv({ cls: 'wechat-platform-picker-header' });
  const platformPickerTitle = platformPickerHeader.createDiv();
  platformPickerTitle.createEl('div', { text: '发布平台（浏览器插件支持）', cls: 'wechat-platform-picker-title' });
  const checkedAtText = formatWechatsyncCheckedAt(multiPlatformSettings.connection?.checkedAt);
  platformPickerTitle.createEl('div', {
    text: hasCachedAuthState
      ? `已勾选平台会显示上次状态${checkedAtText ? `（${checkedAtText}）` : ''}；本次发布仍以浏览器插件实际结果为准。`
      : (hasExtensionPlatformList
        ? '平台清单来自当前连接的浏览器插件；仅勾选的平台会显示上次状态。'
        : '未连接插件前先显示本地备用清单；连接成功后会刷新为插件实际支持的平台。'),
    cls: 'wechat-platform-picker-desc',
  });
  const platformSummary = platformPickerHeader.createDiv({ cls: 'wechat-platform-picker-summary' });
  const updatePlatformSummary = () => {
    platformSummary.setText(`已选择 ${selectedPlatformSet.size} 个`);
  };
  updatePlatformSummary();

  const platformGrid = platformPicker.createDiv({ cls: 'wechat-platform-grid' });
  const saveSelectedPlatforms = async () => {
    const current = normalizeMultiPlatformSyncSettings(plugin.settings.multiPlatformSync);
    plugin.settings.multiPlatformSync = normalizeMultiPlatformSyncSettings({
      ...current,
      selectedPlatforms: Array.from(selectedPlatformSet),
    });
    await plugin.saveSettings();
  };

  for (const platform of availablePlatforms) {
    const authBadge = getPlatformAuthBadge(platform);
    const isSelected = selectedPlatformSet.has(platform.id);
    const chip = platformGrid.createEl('label', {
      cls: `wechat-platform-chip ${isSelected ? `${authBadge.cls} is-selected` : ''}`,
    });
    chip.setAttribute('title', isSelected ? `${platform.name} · ${authBadge.text}` : platform.name);
    const checkbox = chip.createEl('input', { attr: { type: 'checkbox' } });
    checkbox.checked = isSelected;
    checkbox.value = platform.id;
    const chipBody = chip.createEl('span', { cls: 'wechat-platform-chip-body' });
    chipBody.createEl('span', { text: platform.name, cls: 'wechat-platform-chip-name' });
    const statusEl = chipBody.createEl('span', {
      text: authBadge.text,
      cls: `wechat-platform-chip-status ${authBadge.cls}`,
    });
    statusEl.setAttribute('title', authBadge.text);
    const setStatusVisible = (visible) => {
      for (const cls of ['is-ok', 'is-error', 'is-unknown', 'is-bridge']) {
        chip.removeClass?.(cls);
        chip.classList?.remove(cls);
        statusEl.removeClass?.(cls);
        statusEl.classList?.remove(cls);
      }
      statusEl.textContent = authBadge.text;
      if (visible) {
        chip.addClass?.(authBadge.cls);
        chip.classList?.add(authBadge.cls);
        statusEl.addClass?.(authBadge.cls);
        statusEl.classList?.add(authBadge.cls);
      }
      chip.setAttribute('title', visible ? `${platform.name} · ${authBadge.text}` : platform.name);
    };
    checkbox.onchange = async () => {
      if (checkbox.checked) {
        selectedPlatformSet.add(platform.id);
        chip.addClass('is-selected');
        setStatusVisible(true);
        if (authBadge.status === 'login_required') {
          new Notice(`${platform.name} 上次状态为需登录。请先在浏览器插件打开平台登录页，或继续尝试由插件返回实际结果。`, 8000);
        }
      } else {
        selectedPlatformSet.delete(platform.id);
        chip.removeClass('is-selected');
        setStatusVisible(false);
      }
      updatePlatformSummary();
      await saveSelectedPlatforms();
    };
  }

  new Setting(containerEl)
    .setName('测试连接')
    .setDesc('只验证 Obsidian、浏览器插件和连接令牌是否连通，并读取平台清单；不会实时检测所有平台登录状态。')
    .addButton(button => button
      .setButtonText('测试')
      .onClick(async () => {
        button.setButtonText('等待插件...');
        button.setDisabled?.(true);
        const startedAt = Date.now();
        let bridge = null;
        let bridgeStartStatus = null;
        let shouldRedisplay = false;
        try {
          const currentBeforeTest = normalizeMultiPlatformSyncSettings(plugin.settings.multiPlatformSync);
          console.debug('[Wechatsync] test connection started', {
            port: plugin.settings.multiPlatformSync?.port,
            hasToken: !!plugin.settings.multiPlatformSync?.token,
            forceRefresh: false,
          });
          bridge = plugin.getWechatSyncBridgeService();
          bridgeStartStatus = await bridge.start();
          console.debug('[Wechatsync] bridge started', bridgeStartStatus);
          await bridge.waitForConnection(15000);
          console.debug('[Wechatsync] extension connection ready', {
            elapsedMs: Date.now() - startedAt,
          });
          let health = null;
          let capabilities = {};
          try {
            health = await retryRecoverableBridgeOperation(async ({ attempt }) => {
              if (attempt > 0) {
                console.debug('[Wechatsync] retrying health after bridge recovery window', { attempt });
              }
              const healthResult = await bridge.health({ timeoutMs: 5000 });
              if (healthResult?.tokenValid === false) {
                const authError = new Error('连接令牌校验失败。请确认 Obsidian 与浏览器插件使用同一个连接令牌。');
                authError.code = 'AUTH_FAILED';
                throw authError;
              }
              if (healthResult?.ok === false) {
                const healthError = new Error(healthResult.error || '浏览器插件健康检查失败');
                healthError.code = 'BRIDGE_REQUEST_TIMEOUT';
                throw healthError;
              }
              return healthResult;
            }, {
              retries: 2,
              delayMs: 1000,
              logger: console,
              label: 'settings health',
            });
            console.debug('[Wechatsync] health result', health);
            capabilities = normalizeWechatSyncCapabilities(health?.capabilities);
          } catch (healthError) {
            if (!isWechatSyncUnsupportedMethodError(healthError)) throw healthError;
            console.warn('[Wechatsync] extension does not support health, falling back to socket-only check', healthError);
          }
          let supportedPlatforms = [];
          try {
            supportedPlatforms = await getSupportedPlatformsFromExtension(bridge);
            console.debug('[Wechatsync] supported platforms loaded', {
              count: supportedPlatforms.length,
              platforms: supportedPlatforms.map((platform) => platform.id),
            });
          } catch (platformError) {
            if (isWechatSyncUnsupportedMethodError(platformError)) {
              console.warn('[Wechatsync] extension does not support listSupportedPlatforms, keeping fallback list', platformError);
            } else {
              console.warn('[Wechatsync] listSupportedPlatforms failed, keeping existing platform list', platformError);
            }
          }
          const selectedPlatformIds = parseWechatsyncPlatformIds(currentBeforeTest.selectedPlatforms || []);
          const current = normalizeMultiPlatformSyncSettings(plugin.settings.multiPlatformSync);
          const nextPlatforms = normalizeWechatsyncPlatformList(current.connection.platforms || [])
            .filter((platform) => selectedPlatformIds.includes(platform.id));
          plugin.settings.multiPlatformSync = normalizeMultiPlatformSyncSettings({
            ...current,
            supportedPlatforms: supportedPlatforms.length ? supportedPlatforms : current.supportedPlatforms,
            connection: {
              ...current.connection,
              status: 'connected',
              checkedAt: Date.now(),
              platforms: nextPlatforms,
              capabilities,
              message: health
                ? '已连接，连接令牌已通过插件校验。未读取平台登录状态。'
                : '已连接。当前插件版本未提供健康校验，平台登录状态未自动检测。',
            },
          });
          await plugin.saveSettings();
          shouldRedisplay = true;
          new Notice(health
            ? '✅ 已连接浏览器插件，连接令牌校验通过'
            : '✅ 已连接浏览器插件');
        } catch (error) {
          let bridgeStatusAfterFailure = null;
          let diagnostics = null;
          try {
            bridgeStatusAfterFailure = await bridge?.getStatus?.();
          } catch (statusError) {
            bridgeStatusAfterFailure = { error: statusError?.message || String(statusError) };
          }
          try {
            diagnostics = bridge?.getDiagnostics?.() || null;
          } catch {
            diagnostics = null;
          }

          // §4.1 / §7.1: detect state 3 (extension connected but hello rejected) vs
          // state 2 (no extension reached the bridge at all) so the user sees an
          // actionable message instead of the generic timeout text.
          let detailedMessage = error.message || '浏览器插件连接失败';
          let hint = '';
          if (error?.code === 'EXTENSION_NOT_CONNECTED' && diagnostics?.helloRejections > 0) {
            const last = diagnostics.lastHelloRejection;
            const reason = last?.reason;
            if (reason === 'token_mismatch') {
              detailedMessage = '浏览器插件已连接但握手令牌不匹配。请确认 Obsidian 与浏览器插件使用同一个连接令牌。';
            } else if (reason === 'hello_timeout') {
              detailedMessage = '浏览器插件连接后未在限定时间内完成握手。可能扩展版本过旧或未启用握手。';
            } else if (reason === 'invalid_payload') {
              detailedMessage = '浏览器插件发送的握手数据格式不正确。请升级浏览器插件到支持安全握手的版本。';
            } else if (reason === 'version_unsupported') {
              detailedMessage = '浏览器插件版本与 Obsidian 不兼容，握手被拒绝。请升级浏览器插件。';
            } else if (reason) {
              detailedMessage = `浏览器插件握手失败（${reason}）。请检查浏览器插件版本与连接令牌。`;
            }
            hint = '';
          } else if (['EXTENSION_NOT_CONNECTED', 'BRIDGE_UNAVAILABLE', 'BRIDGE_REQUEST_TIMEOUT'].includes(error?.code)) {
            hint = '请确认浏览器正在运行、已安装浏览器插件，并检查地址、端口和连接令牌与这里一致。';
          } else if (error?.code === 'EXTENSION_NOT_AUTHENTICATED') {
            detailedMessage = '浏览器插件已连接但尚未通过认证。请确认插件已升级到支持安全握手的版本，且使用与 Obsidian 一致的连接令牌。';
          }

          console.error('[Wechatsync] test connection failed', {
            elapsedMs: Date.now() - startedAt,
            code: error?.code,
            message: error?.message || String(error),
            stack: error?.stack,
            bridgeStartStatus,
            bridgeStatusAfterFailure,
            diagnostics,
            detailedMessage,
          });
          plugin.settings.multiPlatformSync = normalizeMultiPlatformSyncSettings({
            ...plugin.settings.multiPlatformSync,
            connection: {
              status: 'failed',
              checkedAt: Date.now(),
              platforms: [],
              capabilities: {},
              message: detailedMessage,
            },
          });
          await plugin.saveSettings();
          new Notice(`❌ ${detailedMessage}${hint ? ` ${hint}` : ''}`, 12000);
          shouldRedisplay = true;
        } finally {
          button.setDisabled?.(false);
          button.setButtonText('测试');
          if (shouldRedisplay) tab.display();
        }
      }));

  new Setting(containerEl)
    .setName('读取已选平台状态')
    .setDesc('读取浏览器插件缓存的上次状态，不会实时检测登录；发布时仍以浏览器插件实际执行为准。')
    .addButton(button => button
      .setButtonText('读取')
      .onClick(async () => {
        const current = normalizeMultiPlatformSyncSettings(plugin.settings.multiPlatformSync);
        const platformById = new Map(
          getAvailableWechatsyncPlatforms(current).map((platform) => [platform.id, platform])
        );
        const candidates = parseWechatsyncPlatformIds(current.selectedPlatforms || [])
          .map((id) => platformById.get(id) || { id, name: id })
          .filter((platform) => platform.id);
        if (!candidates.length) {
          new Notice('请先勾选至少一个发布平台');
          return;
        }

        button.setButtonText('读取中...');
        button.setDisabled?.(true);
        const startedAt = Date.now();
        try {
          const bridge = plugin.getWechatSyncBridgeService();
          await bridge.start();
          await bridge.waitForConnection(15000);
          const platformFallbacks = mergeWechatsyncPlatformLists(
            current.supportedPlatforms,
            current.connection?.platforms,
            getFallbackWechatsyncPlatforms()
          );
          const authSnapshot = await getAuthSnapshotFromExtension(
            bridge,
            candidates.map((platform) => platform.id),
            platformFallbacks
          );
          const cachedPlatforms = normalizeWechatsyncPlatformList(authSnapshot.platforms || []);
          console.debug('[Wechatsync] selected platform cached auth snapshot summary', {
            elapsedMs: Date.now() - startedAt,
            checkedAt: authSnapshot.checkedAt,
            ...summarizeWechatsyncPlatformResponse(cachedPlatforms),
          });
          plugin.settings.multiPlatformSync = normalizeMultiPlatformSyncSettings({
            ...current,
            connection: {
              ...current.connection,
              status: 'connected',
              checkedAt: authSnapshot.checkedAt || Date.now(),
              platforms: cachedPlatforms,
              capabilities: {
                ...(current.connection?.capabilities || {}),
                getAuthSnapshot: true,
              },
              message: '已读取所选平台的上次登录状态。',
            },
          });
          await plugin.saveSettings();
          const authenticatedCount = cachedPlatforms.filter((platform) => platform.authenticated).length;
          new Notice(`✅ 已读取 ${cachedPlatforms.length} 个已选平台，${authenticatedCount} 个上次可用`);
          tab.display();
        } catch (error) {
          console.error('[Wechatsync] selected platform cached auth snapshot failed', {
            elapsedMs: Date.now() - startedAt,
            code: error?.code,
            message: error?.message || String(error),
          });
          new Notice(`❌ 读取失败：${error.message}`, 10000);
        } finally {
          button.setDisabled?.(false);
          button.setButtonText('读取');
        }
      }));
}

module.exports = { renderMultiPlatformSettingsTab };
