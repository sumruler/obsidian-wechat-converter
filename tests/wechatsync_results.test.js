import { describe, it, expect } from 'vitest';
import {
  getMultiPlatformResultSummary,
  getWechatSyncResultUrl,
  getFallbackWechatsyncPlatforms,
  normalizeWechatSyncResponseResults,
  normalizeWechatsyncCheckAuthResult,
  normalizeWechatsyncPlatformList,
  normalizeWechatsyncPlatform,
  probeWechatsyncPlatformsIndividually,
  summarizeWechatsyncPlatformResponse,
  updateCachedPlatformsAfterSync,
} from '../services/wechatsync-results.js';

describe('Wechatsync result helpers', () => {
  it('normalizes extension platform auth fields and excludes WeChat', () => {
    expect(normalizeWechatsyncPlatform({
      id: 'zhihu',
      name: '知乎',
      isAuthenticated: true,
      username: 'Lin',
    })).toEqual({
      id: 'zhihu',
      name: '知乎',
      authKnown: true,
      authenticated: true,
      username: 'Lin',
      error: '',
    });

    expect(normalizeWechatsyncPlatform({ id: 'weixin', name: '微信' })).toBeNull();
  });

  it('normalizes wrapped platform lists and nested auth fields from extension responses', () => {
    const response = {
      platforms: [
        {
          id: 'zhihu',
          name: '知乎',
          auth: { isAuthenticated: true, username: 'Lin' },
        },
        {
          id: 'douyin',
          name: '抖音图文',
          status: '已登录',
          accountName: 'home',
        },
        { id: 'weixin', name: '微信公众号', isAuthenticated: true },
      ],
    };

    expect(normalizeWechatsyncPlatformList(response)).toEqual([
      { id: 'zhihu', name: '知乎', authKnown: true, authenticated: true, username: 'Lin', error: '' },
      { id: 'douyin', name: '抖音图文', authKnown: true, authenticated: true, username: 'home', error: '' },
    ]);
    expect(summarizeWechatsyncPlatformResponse(response)).toMatchObject({
      responseKind: 'object',
      rawCount: 3,
      normalizedCount: 2,
      authenticatedCount: 2,
    });
  });

  it('normalizes single-platform checkAuth results with fallback metadata', () => {
    expect(normalizeWechatsyncCheckAuthResult(
      { id: 'zhihu', name: '知乎' },
      { isAuthenticated: true, username: 'Lin' }
    )).toEqual({
      id: 'zhihu',
      name: '知乎',
      authKnown: true,
      authenticated: true,
      username: 'Lin',
      error: '',
    });

    expect(normalizeWechatsyncCheckAuthResult(
      { id: 'missing', name: '缺失平台' },
      { isAuthenticated: false, error: 'Platform not found' }
    )).toBeNull();
  });

  it('probes fallback platforms without letting one failed platform block the rest', async () => {
    const bridge = {
      async checkAuth(platform) {
        if (platform === 'zhihu') return { isAuthenticated: true, username: 'Lin' };
        if (platform === 'juejin') return { isAuthenticated: false, error: '未登录' };
        if (platform === 'missing') return { isAuthenticated: false, error: 'Platform not found' };
        throw new Error('network down');
      },
    };

    const platforms = await probeWechatsyncPlatformsIndividually(bridge, {
      candidates: [
        { id: 'zhihu', name: '知乎' },
        { id: 'juejin', name: '掘金' },
        { id: 'missing', name: '缺失平台' },
        { id: 'broken', name: '失败平台' },
      ],
      concurrency: 2,
      logger: { debug() {} },
    });

    expect(platforms).toEqual([
      { id: 'zhihu', name: '知乎', authKnown: true, authenticated: true, username: 'Lin', error: '' },
      { id: 'juejin', name: '掘金', authKnown: true, authenticated: false, username: '', error: '未登录' },
    ]);
    expect(getFallbackWechatsyncPlatforms().some((platform) => platform.id === 'zhihu')).toBe(true);
  });

  it('normalizes sync responses from arrays, wrapped results, and single results', () => {
    const zhihu = { platform: 'zhihu', success: true, postUrl: 'https://zhuanlan.zhihu.com/p/1/edit' };
    const juejin = { platform: 'juejin', success: false, error: '未登录' };

    expect(normalizeWechatSyncResponseResults({ results: [zhihu, null, juejin] })).toEqual([zhihu, juejin]);
    expect(normalizeWechatSyncResponseResults([zhihu])).toEqual([zhihu]);
    expect(normalizeWechatSyncResponseResults(zhihu)).toEqual([zhihu]);
    expect(normalizeWechatSyncResponseResults({ syncId: 'sync-1' })).toEqual([]);
  });

  it('extracts draft links from common result fields', () => {
    expect(getWechatSyncResultUrl({ postUrl: 'https://example.com/post' })).toBe('https://example.com/post');
    expect(getWechatSyncResultUrl({ draftUrl: 'https://example.com/draft' })).toBe('https://example.com/draft');
    expect(getWechatSyncResultUrl({ editUrl: 'https://example.com/edit' })).toBe('https://example.com/edit');
  });

  it('summarizes partial success and detects auth failures', () => {
    const results = [
      { platform: 'zhihu', success: true, postUrl: 'https://zhuanlan.zhihu.com/p/1/edit' },
      { platform: 'juejin', success: false, error: '未登录，请重新登录' },
      { platform: 'csdn', success: false, error: '发布超时' },
    ];

    const summary = getMultiPlatformResultSummary(results, ['zhihu', 'juejin', 'csdn']);

    expect(summary.successCount).toBe(1);
    expect(summary.failedCount).toBe(2);
    expect(summary.totalCount).toBe(3);
    expect(summary.isAllSuccess).toBe(false);
    expect(summary.authFailedResults.map((item) => item.platform)).toEqual(['juejin']);
  });

  it('updates cached auth state after sync without dropping unaffected platforms', () => {
    const cached = [
      { id: 'zhihu', name: '知乎', authenticated: true, username: 'Lin' },
      { id: 'juejin', name: '掘金', authenticated: true },
      { id: 'csdn', name: 'CSDN', authenticated: true },
    ];
    const results = [
      { platform: 'zhihu', success: true, postUrl: 'https://zhuanlan.zhihu.com/p/1/edit' },
      { platform: 'juejin', success: false, error: '未登录，请重新登录' },
      { platform: 'csdn', success: false, error: '发布超时' },
    ];

    expect(updateCachedPlatformsAfterSync(cached, results)).toEqual([
      { id: 'zhihu', name: '知乎', authKnown: true, authenticated: true, username: 'Lin', error: '' },
      { id: 'juejin', name: '掘金', authKnown: true, authenticated: false, username: '', error: '未登录，请重新登录' },
      { id: 'csdn', name: 'CSDN', authKnown: true, authenticated: true, username: '', error: '' },
    ]);
  });
});
