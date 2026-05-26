// services/wechatsync-settings.js
//
// Pure data helpers for the multi-platform sync (浏览器插件) feature.
// Previously inlined at the top of input.js (lines 73-236). Extracted so
// the views/ layer can normalize / read settings without depending on
// input.js (which would create a cycle).
//
// All functions are pure — no DOM, no Obsidian API, no side effects.

const { DEFAULT_WECHATSYNC_PORT } = require('./wechatsync-bridge');
const {
  buildWechatsyncPlatformCatalog,
  getFallbackWechatsyncPlatforms,
  normalizeWechatsyncPlatform,
} = require('./wechatsync-results');

function createDefaultMultiPlatformSyncSettings() {
  return {
    enabled: false,
    port: DEFAULT_WECHATSYNC_PORT,
    token: '',
    allowRemote: false,
    supportedPlatforms: [],
    connectedClients: [],
    selectedPlatforms: [],
    recentTasks: [],
    connection: {
      status: 'untested',
      checkedAt: 0,
      platforms: [],
      message: '',
    },
  };
}

function normalizeConnectedClient(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.extensionInstanceId || '').trim();
  if (!id) return null;
  const status = value.status === 'connected' ? 'connected' : 'disconnected';
  const now = Date.now();
  return {
    extensionInstanceId: id,
    browserName: typeof value.browserName === 'string' ? value.browserName : '',
    profileLabel: typeof value.profileLabel === 'string' ? value.profileLabel : '',
    capabilities: value.capabilities && typeof value.capabilities === 'object'
      ? { ...value.capabilities }
      : {},
    extensionVersion: typeof value.extensionVersion === 'string' ? value.extensionVersion : '',
    status,
    lastSeenAt: Number.isFinite(Number(value.lastSeenAt)) ? Number(value.lastSeenAt) : now,
    firstConnectedAt: Number.isFinite(Number(value.firstConnectedAt)) ? Number(value.firstConnectedAt) : now,
    lastConnectedAt: Number.isFinite(Number(value.lastConnectedAt)) ? Number(value.lastConnectedAt) : now,
  };
}

function normalizeConnectedClients(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normalizeConnectedClient(entry)).filter(Boolean);
}

function normalizeWechatsyncPlatformId(value = '') {
  const id = String(value || '').trim().toLowerCase();
  if (id === 'twitter') return 'x';
  return id && id !== 'weixin' ? id : '';
}

function parseWechatsyncPlatformIds(value = []) {
  const rawIds = Array.isArray(value)
    ? value
    : String(value || '').split(/[\s,，;；]+/);
  const seen = new Set();
  return rawIds
    .map((id) => normalizeWechatsyncPlatformId(id))
    .filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function mergeWechatsyncPlatformLists(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const platform of Array.isArray(list) ? list : []) {
      const normalized = normalizeWechatsyncPlatform(platform);
      if (!normalized) continue;
      byId.set(normalized.id, {
        ...(byId.get(normalized.id) || {}),
        ...normalized,
      });
    }
  }
  return Array.from(byId.values());
}

function normalizeWechatSyncCapabilities(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const knownKeys = [
    'enqueueSyncArticle',
    'listSupportedPlatforms',
    'checkAuth',
    'getSyncTask',
    'getSyncTaskLink',
    'openSyncTask',
    'getAuthSnapshot',
    'quotaPolicy',
  ];
  return knownKeys.reduce((result, key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = source[key] === true;
    return result;
  }, {});
}

function hasWechatSyncCapability(settings = {}, capability = '') {
  const capabilities = normalizeMultiPlatformSyncSettings(settings).connection.capabilities || {};
  return capabilities[capability] === true;
}

function normalizeWechatSyncRecentTasks(value = []) {
  const tasks = Array.isArray(value) ? value : [];
  const seen = new Set();
  return tasks
    .map((task) => {
      const syncId = String(task?.syncId || '').trim();
      if (!syncId || seen.has(syncId)) return null;
      seen.add(syncId);
      return {
        syncId,
        title: String(task?.title || '无标题文章'),
        platforms: parseWechatsyncPlatformIds(task?.platforms || []),
        createdAt: Number.isFinite(Number(task?.createdAt)) ? Number(task.createdAt) : Date.now(),
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeMultiPlatformConnection(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const status = ['connected', 'failed', 'untested'].includes(source.status)
    ? source.status
    : 'untested';
  return {
    status,
    checkedAt: Number.isFinite(Number(source.checkedAt)) ? Number(source.checkedAt) : 0,
    platforms: Array.isArray(source.platforms)
      ? source.platforms.map((platform) => normalizeWechatsyncPlatform(platform)).filter(Boolean)
      : [],
    message: typeof source.message === 'string' ? source.message : '',
    capabilities: normalizeWechatSyncCapabilities(source.capabilities),
  };
}

function normalizeMultiPlatformSyncSettings(value = {}) {
  const defaults = createDefaultMultiPlatformSyncSettings();
  const source = value && typeof value === 'object' ? value : {};
  const portNumber = Number(source.port);
  const fallbackPlatformIds = new Set(getFallbackWechatsyncPlatforms().map((platform) => platform.id));
  const supportedPlatforms = mergeWechatsyncPlatformLists(source.supportedPlatforms);
  const supportedPlatformIds = new Set(supportedPlatforms.map((platform) => platform.id));
  const selectablePlatformIds = new Set([...fallbackPlatformIds, ...supportedPlatformIds]);
  const selectedPlatforms = parseWechatsyncPlatformIds(source.selectedPlatforms)
    .filter((id) => selectablePlatformIds.has(id));
  return {
    enabled: !!source.enabled,
    port: Number.isInteger(portNumber) && portNumber > 0 && portNumber < 65536
      ? portNumber
      : defaults.port,
    token: typeof source.token === 'string' ? source.token.trim() : '',
    allowRemote: source.allowRemote === true,
    supportedPlatforms,
    selectedPlatforms,
    connection: normalizeMultiPlatformConnection(source.connection),
    recentTasks: normalizeWechatSyncRecentTasks(source.recentTasks),
    connectedClients: normalizeConnectedClients(source.connectedClients),
  };
}

function getConfiguredWechatsyncPlatforms(settings = {}, cachedPlatforms = []) {
  const normalizedSettings = normalizeMultiPlatformSyncSettings(settings);
  const availableById = new Map(
    mergeWechatsyncPlatformLists(getFallbackWechatsyncPlatforms(), normalizedSettings.supportedPlatforms)
      .map((platform) => [platform.id, platform])
  );
  const cachedById = new Map(
    (cachedPlatforms || [])
      .map((platform) => normalizeWechatsyncPlatform(platform))
      .filter(Boolean)
      .map((platform) => [platform.id, platform])
  );

  return (normalizedSettings.selectedPlatforms || [])
    .map((id) => {
      const fallback = availableById.get(id) || { id, name: id, custom: true };
      const cached = cachedById.get(id);
      return cached
        ? { ...fallback, ...cached, authKnown: true }
        : { ...fallback, authKnown: false, authenticated: false, username: '', error: '' };
    })
    .filter((platform) => platform.id !== 'weixin');
}

function getAvailableWechatsyncPlatforms(settings = {}) {
  const normalizedSettings = normalizeMultiPlatformSyncSettings(settings);
  return buildWechatsyncPlatformCatalog({
    supportedPlatforms: normalizedSettings.supportedPlatforms,
    authSnapshotPlatforms: normalizedSettings.connection?.platforms || [],
    bridgeConnected: normalizedSettings.connection?.status === 'connected',
  });
}

module.exports = {
  createDefaultMultiPlatformSyncSettings,
  normalizeConnectedClient,
  normalizeConnectedClients,
  normalizeWechatsyncPlatformId,
  parseWechatsyncPlatformIds,
  mergeWechatsyncPlatformLists,
  normalizeWechatSyncCapabilities,
  hasWechatSyncCapability,
  normalizeWechatSyncRecentTasks,
  normalizeMultiPlatformConnection,
  normalizeMultiPlatformSyncSettings,
  getConfiguredWechatsyncPlatforms,
  getAvailableWechatsyncPlatforms,
};
