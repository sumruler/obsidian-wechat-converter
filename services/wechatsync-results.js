function normalizeWechatsyncPlatform(platform = {}) {
  const id = String(platform.id || platform.type || platform.platform || '').trim();
  if (!id || id === 'weixin') return null;
  return {
    id,
    name: String(platform.name || platform.title || platform.platformName || id),
    authenticated: platform.isAuthenticated === true
      || platform.authenticated === true
      || platform.isAuth === true
      || platform.loggedIn === true
      || platform.status === 'authenticated'
      || platform.status === 'logged_in',
    username: typeof platform.username === 'string' ? platform.username : '',
    error: typeof platform.error === 'string' ? platform.error : '',
  };
}

function getWechatSyncResultPlatformId(result = {}) {
  return String(result.platform || result.id || result.type || '').trim();
}

function getWechatSyncResultError(result = {}) {
  return String(result.error || result.message || '').trim();
}

function getWechatSyncResultUrl(result = {}) {
  return String(result.postUrl || result.draftUrl || result.editUrl || result.url || result.link || '').trim();
}

function isWechatSyncAuthFailureMessage(message = '') {
  return /未登录|登录|auth|unauthori[sz]ed|forbidden|cookie|token|鉴权|401|403/i.test(String(message || ''));
}

function isWechatSyncConnectionFailure(error = {}) {
  return ['AUTH_FAILED', 'EXTENSION_NOT_CONNECTED', 'BRIDGE_UNAVAILABLE'].includes(error?.code);
}

function normalizeWechatSyncResponseResults(result) {
  if (Array.isArray(result?.results)) return result.results.filter(Boolean);
  if (Array.isArray(result)) return result.filter(Boolean);
  if (result && typeof result === 'object' && 'success' in result) return [result];
  return [];
}

function getMultiPlatformResultSummary(results = [], requestedPlatformIds = [], fatalError = null) {
  const normalizedResults = normalizeWechatSyncResponseResults(results);
  const successResults = normalizedResults.filter((item) => item?.success === true);
  const failedResults = normalizedResults.filter((item) => item?.success === false);
  const authFailedResults = failedResults.filter((item) => isWechatSyncAuthFailureMessage(getWechatSyncResultError(item)));
  const totalCount = normalizedResults.length || requestedPlatformIds.length;
  return {
    normalizedResults,
    successResults,
    failedResults,
    authFailedResults,
    successCount: successResults.length,
    failedCount: failedResults.length,
    totalCount,
    isAllSuccess: totalCount > 0 && !fatalError && successResults.length === totalCount,
  };
}

function updateCachedPlatformsAfterSync(cachedPlatforms = [], results = []) {
  const byId = new Map();
  for (const platform of cachedPlatforms) {
    const normalized = normalizeWechatsyncPlatform(platform);
    if (normalized) byId.set(normalized.id, normalized);
  }

  for (const result of normalizeWechatSyncResponseResults(results)) {
    const platformId = getWechatSyncResultPlatformId(result);
    if (!platformId || platformId === 'weixin') continue;
    const previous = byId.get(platformId) || normalizeWechatsyncPlatform(result) || {
      id: platformId,
      name: platformId,
      authenticated: false,
    };
    const errorMessage = getWechatSyncResultError(result);

    if (result?.success === true) {
      byId.set(platformId, {
        ...previous,
        authenticated: true,
        error: '',
      });
      continue;
    }

    if (isWechatSyncAuthFailureMessage(errorMessage)) {
      byId.set(platformId, {
        ...previous,
        authenticated: false,
        error: errorMessage,
      });
    }
  }

  return Array.from(byId.values());
}

module.exports = {
  getMultiPlatformResultSummary,
  getWechatSyncResultError,
  getWechatSyncResultPlatformId,
  getWechatSyncResultUrl,
  isWechatSyncAuthFailureMessage,
  isWechatSyncConnectionFailure,
  normalizeWechatSyncResponseResults,
  normalizeWechatsyncPlatform,
  updateCachedPlatformsAfterSync,
};
