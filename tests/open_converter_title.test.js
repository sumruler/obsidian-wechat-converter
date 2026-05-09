import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('AppleStylePlugin - openConverter title refresh', () => {
  let AppleStylePlugin;

  beforeEach(() => {
    vi.resetModules();
    AppleStylePlugin = require('../input.js');
  });

  it('should refresh stale converter leaf title to unified name', async () => {
    const plugin = new AppleStylePlugin();
    const setViewState = vi.fn().mockResolvedValue(undefined);
    const revealLeaf = vi.fn();
    const staleLeaf = {
      getViewState: vi.fn(() => ({
        type: 'apple-style-converter',
        state: {},
        icon: 'wand',
        title: '微信排版转换',
      })),
      setViewState,
    };

    plugin.app = {
      workspace: {
        getLeavesOfType: vi.fn(() => [staleLeaf]),
        revealLeaf,
      },
    };

    await plugin.openConverter();

    expect(setViewState).toHaveBeenCalledTimes(1);
    expect(setViewState).toHaveBeenCalledWith({
      type: 'apple-style-converter',
      state: {},
      icon: 'wand',
      title: 'Obsidian 发布助手',
      active: true,
    });
    expect(revealLeaf).toHaveBeenCalledWith(staleLeaf);
  });

  it('should not reset converter leaf when title is already up to date', async () => {
    const plugin = new AppleStylePlugin();
    const setViewState = vi.fn().mockResolvedValue(undefined);
    const revealLeaf = vi.fn();
    const freshLeaf = {
      getViewState: vi.fn(() => ({
        type: 'apple-style-converter',
        state: { keep: true },
        icon: 'wand',
        title: 'Obsidian 发布助手',
      })),
      setViewState,
    };

    plugin.app = {
      workspace: {
        getLeavesOfType: vi.fn(() => [freshLeaf]),
        revealLeaf,
      },
    };

    await plugin.openConverter();

    expect(setViewState).not.toHaveBeenCalled();
    expect(revealLeaf).toHaveBeenCalledWith(freshLeaf);
  });

  it('should migrate stale leaf titles during startup reconciliation', async () => {
    const plugin = new AppleStylePlugin();
    const staleLeafSetViewState = vi.fn().mockResolvedValue(undefined);
    const freshLeafSetViewState = vi.fn().mockResolvedValue(undefined);
    const staleLeaf = {
      getViewState: vi.fn(() => ({
        type: 'apple-style-converter',
        state: { from: 'restore' },
        icon: 'wand',
        title: '微信排版转换',
      })),
      setViewState: staleLeafSetViewState,
    };
    const freshLeaf = {
      getViewState: vi.fn(() => ({
        type: 'apple-style-converter',
        state: { from: 'restore' },
        icon: 'wand',
        title: 'Obsidian 发布助手',
      })),
      setViewState: freshLeafSetViewState,
    };

    plugin.app = {
      workspace: {
        getLeavesOfType: vi.fn(() => [staleLeaf, freshLeaf]),
      },
    };

    await plugin.migrateLegacyConverterLeafTitles();

    expect(staleLeafSetViewState).toHaveBeenCalledTimes(1);
    expect(staleLeafSetViewState).toHaveBeenCalledWith({
      type: 'apple-style-converter',
      state: { from: 'restore' },
      icon: 'wand',
      title: 'Obsidian 发布助手',
      active: false,
    });
    expect(freshLeafSetViewState).not.toHaveBeenCalled();
  });
});
