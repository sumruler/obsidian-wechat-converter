// views/settings/multi-platform-tab.js
//
// Renders the「其他平台」settings tab. Extracted from input.js display()
// (originally lines 6088-6521). The tab is one cohesive block:
//   1. enable toggle
//   2. port + token inputs
//   3. persistent connection status bar (Phase 2 helper)
//   4. platform picker grid (chip per platform with auth status)
//   5. 测试连接 button (start bridge + health + listSupportedPlatforms +
//      getAuthSnapshot for selected platforms)
//   6. 诊断已选平台登录状态 button (batch checkAuth with single-probe fallback)
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
  probeWechatsyncPlatformsIndividually,
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

function renderMultiPlatformSettingsTab(tab, containerEl) {
  const { plugin } = tab;
  const multiPlatformSettings = normalizeMultiPlatformSyncSettings(plugin.settings.multiPlatformSync);
  plugin.settings.multiPlatformSync = multiPlatformSettings;

  new Setting(containerEl)
    .setName('浏览器插件发布')
    .setDesc('Obsidian 负责写作、预览和平台选择；浏览器插件使用当前的浏览器登录态，把文章保存到知乎、掘金、CSDN 等平台草稿箱。微信仍可使用上方公众号 API。')
    .setHeading();

  new Setting(containerEl)
    .setName('启用浏览器插件发布')
    .setDesc('开启后，确保目标平台在浏览器中已登录，即可发布。')
    .addToggle(toggle => toggle
      .setValue(multiPlatformSettings.enabled)
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
          const platformFallbacks = mergeWechatsyncPlatformLists(
            supportedPlatforms,
            currentBeforeTest.supportedPlatforms,
            getFallbackWechatsyncPlatforms()
          );
          const selectedPlatformIds = parseWechatsyncPlatformIds(currentBeforeTest.selectedPlatforms || []);
          let authSnapshot = null;
          if (selectedPlatformIds.length > 0) {
            try {
              authSnapshot = await getAuthSnapshotFromExtension(
                bridge,
                selectedPlatformIds,
                platformFallbacks
              );
              capabilities = { ...capabilities, getAuthSnapshot: true };
              console.debug('[Wechatsync] selected auth snapshot loaded', {
                checkedAt: authSnapshot.checkedAt,
                selectedPlatformIds,
                ...summarizeWechatsyncPlatformResponse(authSnapshot.platforms),
              });
            } catch (snapshotError) {
              if (isWechatSyncUnsupportedMethodError(snapshotError)) {
                capabilities = { ...capabilities, getAuthSnapshot: false };
              }
              console.warn('[Wechatsync] getAuthSnapshot failed, keeping existing selected auth state', snapshotError);
            }
          }
          const current = normalizeMultiPlatformSyncSettings(plugin.settings.multiPlatformSync);
          const nextPlatforms = authSnapshot?.platforms?.length
            ? authSnapshot.platforms
            : normalizeWechatsyncPlatformList(current.connection.platforms || [])
              .filter((platform) => selectedPlatformIds.includes(platform.id));
          const connectionCheckedAt = authSnapshot?.checkedAt || Date.now();
          plugin.settings.multiPlatformSync = normalizeMultiPlatformSyncSettings({
            ...current,
            supportedPlatforms: supportedPlatforms.length ? supportedPlatforms : current.supportedPlatforms,
            connection: {
              ...current.connection,
              status: 'connected',
              checkedAt: connectionCheckedAt,
              platforms: nextPlatforms,
              capabilities,
              message: health
                ? (authSnapshot?.platforms?.length
                  ? '已连接，连接令牌已通过插件校验，并读取了已选平台的上次状态。'
                  : '已连接，连接令牌已通过插件校验。未检测平台登录状态。')
                : '已连接。当前插件版本未提供健康校验，平台登录状态未自动检测。',
            },
          });
          await plugin.saveSettings();
          shouldRedisplay = supportedPlatforms.length > 0 || !!authSnapshot;
          new Notice(health
            ? '✅ 已连接浏览器插件，连接令牌校验通过'
            : '✅ 已连接浏览器插件');
        } catch (error) {
          let bridgeStatusAfterFailure = null;
          try {
            bridgeStatusAfterFailure = await bridge?.getStatus?.();
          } catch (statusError) {
            bridgeStatusAfterFailure = { error: statusError?.message || String(statusError) };
          }
          console.error('[Wechatsync] test connection failed', {
            elapsedMs: Date.now() - startedAt,
            code: error?.code,
            message: error?.message || String(error),
            stack: error?.stack,
            bridgeStartStatus,
            bridgeStatusAfterFailure,
          });
          plugin.settings.multiPlatformSync = normalizeMultiPlatformSyncSettings({
            ...plugin.settings.multiPlatformSync,
            connection: {
              status: 'failed',
              checkedAt: Date.now(),
              platforms: [],
              capabilities: {},
              message: error.message || '浏览器插件连接失败',
            },
          });
          await plugin.saveSettings();
          const hint = ['EXTENSION_NOT_CONNECTED', 'BRIDGE_UNAVAILABLE', 'BRIDGE_REQUEST_TIMEOUT'].includes(error?.code)
            ? '请到浏览器插件里检查本地服务连接是否已开启，并确认浏览器正在运行、地址、端口和连接令牌与这里一致。'
            : '';
          new Notice(`❌ 浏览器插件连接失败：${error.message}${hint ? ` ${hint}` : ''}`, 12000);
          shouldRedisplay = true;
        } finally {
          button.setDisabled?.(false);
          button.setButtonText('测试');
          if (shouldRedisplay) tab.display();
        }
      }));

  new Setting(containerEl)
    .setName('诊断已选平台登录状态')
    .setDesc('可选诊断。只检测上方已勾选的平台，结果作为上次状态提示；发布时仍以浏览器插件实际执行为准。')
    .addButton(button => button
      .setButtonText('诊断')
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

        button.setButtonText('诊断中...');
        button.setDisabled?.(true);
        const startedAt = Date.now();
        try {
          const bridge = plugin.getWechatSyncBridgeService();
          await bridge.start();
          await bridge.waitForConnection(15000);
          let usablePlatforms = [];
          try {
            const batchAuth = await bridge.checkAuth(candidates.map((platform) => platform.id), {
              timeoutMs: 10000,
              forceRefresh: true,
            });
            usablePlatforms = normalizeWechatsyncPlatformList(batchAuth);
          } catch (batchError) {
            console.warn('[Wechatsync] batch selected platform auth diagnostic failed, falling back to single checks', {
              code: batchError?.code,
              message: batchError?.message || String(batchError),
            });
            usablePlatforms = await probeWechatsyncPlatformsIndividually(bridge, {
              candidates,
              timeoutMs: 6000,
              concurrency: 4,
              logger: console,
            });
          }
          console.debug('[Wechatsync] selected platform auth diagnostic summary', {
            elapsedMs: Date.now() - startedAt,
            ...summarizeWechatsyncPlatformResponse(usablePlatforms),
          });
          plugin.settings.multiPlatformSync = normalizeMultiPlatformSyncSettings({
            ...current,
            connection: {
              ...current.connection,
              status: 'connected',
              checkedAt: Date.now(),
              platforms: usablePlatforms,
              message: '已诊断所选平台登录状态。',
            },
          });
          await plugin.saveSettings();
          const authenticatedCount = usablePlatforms.filter((platform) => platform.authenticated).length;
          new Notice(`✅ 已诊断 ${usablePlatforms.length} 个已选平台，${authenticatedCount} 个上次可用`);
          tab.display();
        } catch (error) {
          console.error('[Wechatsync] selected platform auth diagnostic failed', {
            elapsedMs: Date.now() - startedAt,
            code: error?.code,
            message: error?.message || String(error),
          });
          new Notice(`❌ 诊断失败：${error.message}`, 10000);
        } finally {
          button.setDisabled?.(false);
          button.setButtonText('诊断');
        }
      }));
}

module.exports = { renderMultiPlatformSettingsTab };
