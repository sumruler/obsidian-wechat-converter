const FEATURED_WECHATSYNC_PLATFORM_ORDER = [
  'xiaohongshu',
  'zhihu',
  'weibo',
  'douyin',
  'toutiao',
  'bilibili',
  'csdn',
  'yuque',
  'jianshu',
  'smzdm',
];

const FEATURED_WECHATSYNC_PLATFORM_RANK = new Map(
  FEATURED_WECHATSYNC_PLATFORM_ORDER.map((id, index) => [id, index])
);

const FALLBACK_WECHATSYNC_PLATFORMS = [
  { id: 'xiaohongshu', name: '小红书', homepage: 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=article', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'zhihu', name: '知乎', homepage: 'https://www.zhihu.com', capabilities: ['article', 'draft', 'image_upload', 'tags', 'cover'] },
  { id: 'weibo', name: '微博', homepage: 'https://card.weibo.com/article/v5/editor', capabilities: ['article', 'draft', 'image_upload', 'cover'] },
  { id: 'douyin', name: '抖音图文', homepage: 'https://creator.douyin.com', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'toutiao', name: '头条号', homepage: 'https://mp.toutiao.com/profile_v4/graphic/publish', capabilities: ['article', 'draft', 'image_upload', 'cover'] },
  { id: 'bilibili', name: 'B站专栏', homepage: 'https://member.bilibili.com/platform/upload/text', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'csdn', name: 'CSDN', homepage: 'https://editor.csdn.net/md/', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'yuque', name: '语雀', homepage: 'https://www.yuque.com/dashboard', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'jianshu', name: '简书', homepage: 'https://www.jianshu.com', capabilities: ['article', 'draft', 'image_upload', 'categories'] },
  { id: 'smzdm', name: '什么值得买', homepage: 'https://post.smzdm.com/tougao/', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'juejin', name: '掘金', homepage: 'https://juejin.cn', capabilities: ['article', 'draft', 'image_upload', 'categories', 'tags', 'cover'] },
  { id: 'baijiahao', name: '百家号', homepage: 'https://baijiahao.baidu.com/', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'douban', name: '豆瓣', homepage: 'https://www.douban.com/note/create', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'sohu', name: '搜狐号', homepage: 'https://mp.sohu.com/mpfe/v3/main/first/page?newsType=1', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'xueqiu', name: '雪球', homepage: 'https://mp.xueqiu.com/writeV2', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'woshipm', name: '人人都是产品经理', homepage: 'https://www.woshipm.com', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'dayu', name: '大鱼号', homepage: 'https://mp.dayu.com/dashboard/account/profile', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'yidian', name: '一点号', homepage: 'https://mp.yidianzixun.com', capabilities: ['article', 'draft', 'image_upload'] },
  { id: '51cto', name: '51CTO', homepage: 'https://blog.51cto.com/blogger/publish', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'imooc', name: '慕课手记', homepage: 'https://www.imooc.com/article', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'oschina', name: '开源中国', homepage: 'https://my.oschina.net', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'segmentfault', name: '思否', homepage: 'https://segmentfault.com/user/draft', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'cnblogs', name: '博客园', homepage: 'https://www.cnblogs.com', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'sohufocus', name: '搜狐焦点', homepage: 'https://mp.focus.cn/fe/index.html#/info/draft', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'x', name: 'X (Twitter)', homepage: 'https://x.com/compose/articles', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'eastmoney', name: '东方财富', homepage: 'https://mp.eastmoney.com', capabilities: ['article', 'draft', 'image_upload', 'cover'] },
  { id: 'netease', name: '网易号', homepage: 'https://mp.163.com/#/article-publish', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'wordpress', name: 'WordPress', homepage: '', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'typecho', name: 'Typecho', homepage: '', capabilities: ['article', 'draft', 'image_upload'] },
  { id: 'zip-download', name: 'Markdown 压缩包', homepage: '', capabilities: ['article'] },
];

function getFallbackWechatsyncPlatforms() {
  return FALLBACK_WECHATSYNC_PLATFORMS.map((platform) => ({ ...platform }));
}

function isPlatformNotFoundError(error = '') {
  return /platform not found|adapter not found|not found/i.test(String(error || ''));
}

function normalizeWechatsyncCapabilities(platform = {}) {
  const rawCapabilities = Array.isArray(platform.capabilities) ? platform.capabilities : [];
  const capabilitySet = new Set(rawCapabilities.map((capability) => String(capability || '').trim()).filter(Boolean));
  if (platform.supportsArticle === true) capabilitySet.add('article');
  if (platform.supportsDraft === true || platform.draft === true) capabilitySet.add('draft');
  if (platform.supportsImageUpload === true || platform.imageUpload === true || platform.supportsImages === true) {
    capabilitySet.add('image_upload');
  }
  if (platform.supportsCover === true || platform.cover === true) capabilitySet.add('cover');
  if (platform.supportsTags === true || platform.tags === true) capabilitySet.add('tags');
  if (platform.supportsCategories === true || platform.categories === true) capabilitySet.add('categories');
  return Array.from(capabilitySet);
}

function normalizeWechatsyncPlatform(platform = {}) {
  const id = String(platform.id || platform.type || platform.platform || '').trim();
  if (!id || id === 'weixin') return null;
  const nestedAuth = platform.auth && typeof platform.auth === 'object' ? platform.auth : {};
  const user = platform.user && typeof platform.user === 'object' ? platform.user : {};
  const rawStatus = String(platform.status || platform.authStatus || platform.authState || '').trim();
  const authStatus = ['available', 'login_required', 'unknown', 'bridge_required'].includes(rawStatus)
    ? rawStatus
    : '';
  const hasExplicitAuthKnown = Object.prototype.hasOwnProperty.call(platform, 'authKnown');
  const authKnown = hasExplicitAuthKnown
    ? platform.authKnown === true
    : (Object.prototype.hasOwnProperty.call(platform, 'isAuthenticated')
      || Object.prototype.hasOwnProperty.call(platform, 'authenticated')
      || Object.prototype.hasOwnProperty.call(platform, 'isAuth')
      || Object.prototype.hasOwnProperty.call(platform, 'loggedIn')
      || Object.prototype.hasOwnProperty.call(nestedAuth, 'isAuthenticated')
      || Object.prototype.hasOwnProperty.call(nestedAuth, 'authenticated')
      || Object.prototype.hasOwnProperty.call(nestedAuth, 'loggedIn')
      || typeof platform.status === 'string');
  return {
    id,
    name: String(platform.name || platform.title || platform.platformName || id),
    homepage: typeof platform.homepage === 'string' ? platform.homepage : '',
    icon: typeof platform.icon === 'string' ? platform.icon : '',
    capabilities: normalizeWechatsyncCapabilities(platform),
    authStatus,
    authKnown,
    authenticated: platform.isAuthenticated === true
      || platform.authenticated === true
      || platform.isAuth === true
      || platform.loggedIn === true
      || nestedAuth.isAuthenticated === true
      || nestedAuth.authenticated === true
      || nestedAuth.loggedIn === true
      || authStatus === 'available'
      || platform.status === 'authenticated'
      || platform.status === 'logged_in'
      || platform.status === '已登录',
    username: typeof platform.username === 'string'
      ? platform.username
      : (typeof platform.accountName === 'string'
        ? platform.accountName
        : (typeof nestedAuth.username === 'string'
          ? nestedAuth.username
          : (typeof user.name === 'string' ? user.name : ''))),
    error: typeof platform.error === 'string' ? platform.error : '',
  };
}

function getWechatsyncPlatformStatus(platform = {}, options = {}) {
  if (options.bridgeConnected === false || platform.authStatus === 'bridge_required') return 'bridge_required';
  const explicitStatus = String(platform.authStatus || platform.authState || '').trim();
  if (['available', 'login_required', 'unknown', 'bridge_required'].includes(explicitStatus)) return explicitStatus;
  if (!platform.authKnown) return 'unknown';
  return platform.authenticated ? 'available' : 'login_required';
}

function getWechatsyncPlatformStatusBadge(platform = {}, options = {}) {
  const status = getWechatsyncPlatformStatus(platform, options);
  if (status === 'bridge_required') return { status, text: '需连接浏览器插件', cls: 'is-bridge' };
  if (status === 'available') {
    return {
      status,
      text: platform.username ? `上次可用 · ${platform.username}` : '上次可用',
      cls: 'is-ok',
    };
  }
  if (status === 'login_required') {
    return { status, text: platform.error || '需登录', cls: 'is-error' };
  }
  return { status: 'unknown', text: '未检测', cls: 'is-unknown' };
}

function getWechatsyncPlatformIdFromItem(item = {}) {
  return String(item?.id || item?.platform || item?.type || item || '').trim();
}

function getWechatsyncPlatformSortRank(platformId = '') {
  return FEATURED_WECHATSYNC_PLATFORM_RANK.has(platformId)
    ? FEATURED_WECHATSYNC_PLATFORM_RANK.get(platformId)
    : FEATURED_WECHATSYNC_PLATFORM_ORDER.length + 1000;
}

function isWechatsyncPlatformAuthenticated(platform = {}, bridgeConnected = true) {
  if (bridgeConnected === false) return false;
  const status = getWechatsyncPlatformStatus(platform, { bridgeConnected });
  return status === 'available' || platform?.authenticated === true;
}

function sortWechatsyncPlatformItemsForDisplay(items = [], options = {}) {
  const {
    bridgeConnected = true,
    authenticatedFirst = bridgeConnected !== false,
    getPlatformId = getWechatsyncPlatformIdFromItem,
    getPlatform = (item) => item,
  } = options;
  return (Array.isArray(items) ? items : [])
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((a, b) => {
      const aPlatform = getPlatform(a.item) || {};
      const bPlatform = getPlatform(b.item) || {};
      if (authenticatedFirst) {
        const authDiff = Number(isWechatsyncPlatformAuthenticated(bPlatform, bridgeConnected))
          - Number(isWechatsyncPlatformAuthenticated(aPlatform, bridgeConnected));
        if (authDiff !== 0) return authDiff;
      }

      const aRank = getWechatsyncPlatformSortRank(getPlatformId(a.item));
      const bRank = getWechatsyncPlatformSortRank(getPlatformId(b.item));
      return aRank - bRank || a.originalIndex - b.originalIndex;
    })
    .map(({ item }) => item);
}

function sortWechatsyncPlatformsForDisplay(platforms = [], options = {}) {
  return sortWechatsyncPlatformItemsForDisplay(platforms, {
    ...options,
    getPlatformId: (platform) => platform?.id,
    getPlatform: (platform) => platform,
  });
}

function buildWechatsyncPlatformCatalog(options = {}) {
  const {
    fallbackPlatforms = getFallbackWechatsyncPlatforms(),
    supportedPlatforms = [],
    authSnapshotPlatforms = [],
    bridgeConnected = true,
  } = options;
  const normalizedSupported = normalizeWechatsyncPlatformList(supportedPlatforms);
  const basePlatforms = bridgeConnected && normalizedSupported.length
    ? normalizedSupported
    : normalizeWechatsyncPlatformList(fallbackPlatforms);
  const authById = new Map(
    normalizeWechatsyncPlatformList(authSnapshotPlatforms).map((platform) => [platform.id, platform])
  );
  const catalog = [];
  const seen = new Set();

  for (const base of basePlatforms) {
    const auth = authById.get(base.id);
    const merged = {
      ...base,
      ...(auth || {}),
      name: base.name || auth?.name || base.id,
      homepage: base.homepage || auth?.homepage || '',
      icon: base.icon || auth?.icon || '',
      capabilities: base.capabilities?.length ? base.capabilities : (auth?.capabilities || []),
    };
    catalog.push(bridgeConnected
      ? (auth ? merged : { ...merged, authKnown: false, authenticated: false, username: '', error: '' })
      : { ...merged, authStatus: 'bridge_required', authKnown: true, authenticated: false, username: '', error: '' });
    seen.add(base.id);
  }

  if (bridgeConnected) {
    for (const auth of authById.values()) {
      if (seen.has(auth.id)) continue;
      catalog.push(auth);
    }
  }

  return sortWechatsyncPlatformsForDisplay(catalog, {
    bridgeConnected,
    authenticatedFirst: bridgeConnected,
  });
}

function normalizeWechatsyncCheckAuthResult(candidate = {}, auth = {}) {
  const error = typeof auth?.error === 'string' ? auth.error : '';
  if (isPlatformNotFoundError(error)) return null;
  return normalizeWechatsyncPlatform({
    ...auth,
    id: candidate.id,
    name: candidate.name,
    type: candidate.id,
    platform: candidate.id,
  });
}

async function probeWechatsyncPlatformsIndividually(bridge, options = {}) {
  const {
    candidates = getFallbackWechatsyncPlatforms(),
    timeoutMs = 6000,
    concurrency = 4,
    logger = console,
  } = options;
  const results = [];

  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(async (candidate) => {
      try {
        const auth = await bridge.checkAuth(candidate.id, { timeoutMs });
        const normalized = normalizeWechatsyncCheckAuthResult(candidate, auth);
        logger.debug?.('[Wechatsync] fallback checkAuth result', {
          id: candidate.id,
          name: candidate.name,
          authenticated: normalized?.authenticated,
          error: auth?.error || '',
        });
        return normalized;
      } catch (error) {
        logger.debug?.('[Wechatsync] fallback checkAuth failed', {
          id: candidate.id,
          name: candidate.name,
          code: error?.code,
          message: error?.message || String(error),
        });
        return null;
      }
    }));
    results.push(...batchResults.filter(Boolean));
  }

  const byId = new Map();
  for (const platform of results) {
    if (!byId.has(platform.id)) byId.set(platform.id, platform);
  }
  return Array.from(byId.values());
}

function normalizeWechatsyncPlatformList(response) {
  const candidates = Array.isArray(response)
    ? response
    : (Array.isArray(response?.platforms)
      ? response.platforms
      : (Array.isArray(response?.result)
        ? response.result
        : (Array.isArray(response?.data) ? response.data : [])));

  return candidates
    .map((platform) => normalizeWechatsyncPlatform(platform))
    .filter(Boolean);
}

function normalizeWechatsyncAuthSnapshot(response = {}, fallbackPlatforms = []) {
  const source = response && typeof response === 'object' ? response : {};
  const fallbackById = new Map(
    (Array.isArray(fallbackPlatforms) ? fallbackPlatforms : [])
      .map((platform) => normalizeWechatsyncPlatform(platform))
      .filter(Boolean)
      .map((platform) => [platform.id, platform])
  );
  const platforms = normalizeWechatsyncPlatformList(source).map((platform) => {
    const fallback = fallbackById.get(platform.id) || {};
    return {
      ...fallback,
      ...platform,
      name: platform.name && platform.name !== platform.id ? platform.name : (fallback.name || platform.name),
    };
  });
  const checkedAt = Number.isFinite(Number(source.checkedAt))
    ? Number(source.checkedAt)
    : platforms.reduce((latest, platform) => {
      const candidate = Number(platform.checkedAt || platform.lastSuccessAt || platform.lastFailureAt || 0);
      return Number.isFinite(candidate) && candidate > latest ? candidate : latest;
    }, 0);
  return {
    source: typeof source.source === 'string' ? source.source : 'cache',
    checkedAt,
    platforms,
  };
}

function summarizeWechatsyncPlatformResponse(response) {
  const rawPlatforms = Array.isArray(response)
    ? response
    : (Array.isArray(response?.platforms)
      ? response.platforms
      : (Array.isArray(response?.result)
        ? response.result
        : (Array.isArray(response?.data) ? response.data : [])));
  const normalized = normalizeWechatsyncPlatformList(response);
  return {
    responseKind: Array.isArray(response) ? 'array' : typeof response,
    rawCount: rawPlatforms.length,
    normalizedCount: normalized.length,
    authenticatedCount: normalized.filter((platform) => platform.authenticated).length,
    platforms: normalized.map((platform) => ({
      id: platform.id,
      name: platform.name,
      authenticated: platform.authenticated,
      username: platform.username,
    })),
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
  return ['AUTH_FAILED', 'EXTENSION_NOT_CONNECTED', 'EXTENSION_NOT_AUTHENTICATED', 'BRIDGE_UNAVAILABLE', 'PLATFORM_LIST_TIMEOUT'].includes(error?.code);
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
  FEATURED_WECHATSYNC_PLATFORM_ORDER,
  buildWechatsyncPlatformCatalog,
  getFallbackWechatsyncPlatforms,
  getMultiPlatformResultSummary,
  getWechatSyncResultError,
  getWechatSyncResultPlatformId,
  getWechatSyncResultUrl,
  getWechatsyncPlatformStatus,
  getWechatsyncPlatformStatusBadge,
  isWechatSyncAuthFailureMessage,
  isWechatSyncConnectionFailure,
  normalizeWechatSyncResponseResults,
  normalizeWechatsyncAuthSnapshot,
  normalizeWechatsyncCheckAuthResult,
  normalizeWechatsyncCapabilities,
  normalizeWechatsyncPlatformList,
  normalizeWechatsyncPlatform,
  probeWechatsyncPlatformsIndividually,
  sortWechatsyncPlatformItemsForDisplay,
  sortWechatsyncPlatformsForDisplay,
  summarizeWechatsyncPlatformResponse,
  updateCachedPlatformsAfterSync,
};
