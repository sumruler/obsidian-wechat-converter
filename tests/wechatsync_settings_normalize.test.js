// Pure-function tests for wechatsync settings normalize, focused on the
// security-relevant defaults introduced in Sprint 1 (§4.1).
//
// These guard against accidental regressions like:
//   - default switching from allowRemote: false (loopback) to true (0.0.0.0)
//   - allowLegacyUnauthenticated leaking truthy when an old data.json has
//     unrelated fields named "allow*"
//   - token / port / connection.status getting silently reset to defaults
//     when a partial object is normalized

import { describe, it, expect } from 'vitest';

const {
  createDefaultMultiPlatformSyncSettings,
  normalizeMultiPlatformSyncSettings,
} = require('../services/wechatsync-settings');

describe('Sprint 1 §4.1 normalizeMultiPlatformSyncSettings — security defaults', () => {
  it('createDefaultMultiPlatformSyncSettings returns the expected hardened defaults', () => {
    const defaults = createDefaultMultiPlatformSyncSettings();
    expect(defaults.allowRemote).toBe(false);
    expect(defaults.allowLegacyUnauthenticated).toBe(false);
    expect(defaults.enabled).toBe(false);
    expect(defaults.token).toBe('');
    expect(defaults.connection.status).toBe('untested');
  });

  it('normalize on a missing object returns hardened defaults', () => {
    const normalized = normalizeMultiPlatformSyncSettings();
    expect(normalized.allowRemote).toBe(false);
    expect(normalized.allowLegacyUnauthenticated).toBe(false);
  });

  it('normalize on an empty object returns hardened defaults', () => {
    const normalized = normalizeMultiPlatformSyncSettings({});
    expect(normalized.allowRemote).toBe(false);
    expect(normalized.allowLegacyUnauthenticated).toBe(false);
  });

  it('normalize coerces non-boolean truthy values to false (strict === true)', () => {
    // Defense against a stale data.json where a previous version stored these
    // fields as 1 / 'true' / 'yes' / non-empty strings — we want strict opt-in.
    const cases = [
      { allowRemote: 1, allowLegacyUnauthenticated: 1 },
      { allowRemote: 'true', allowLegacyUnauthenticated: 'true' },
      { allowRemote: 'yes', allowLegacyUnauthenticated: 'yes' },
      { allowRemote: {}, allowLegacyUnauthenticated: {} },
      { allowRemote: [], allowLegacyUnauthenticated: [] },
    ];
    for (const input of cases) {
      const normalized = normalizeMultiPlatformSyncSettings(input);
      expect(normalized.allowRemote).toBe(false);
      expect(normalized.allowLegacyUnauthenticated).toBe(false);
    }
  });

  it('normalize accepts only the literal boolean true to opt into remote / legacy mode', () => {
    const normalized = normalizeMultiPlatformSyncSettings({
      allowRemote: true,
      allowLegacyUnauthenticated: true,
    });
    expect(normalized.allowRemote).toBe(true);
    expect(normalized.allowLegacyUnauthenticated).toBe(true);
  });

  it('normalize coerces explicit false correctly', () => {
    const normalized = normalizeMultiPlatformSyncSettings({
      allowRemote: false,
      allowLegacyUnauthenticated: false,
    });
    expect(normalized.allowRemote).toBe(false);
    expect(normalized.allowLegacyUnauthenticated).toBe(false);
  });

  it('normalize preserves token, port and selected platforms while still hardening the security flags', () => {
    const normalized = normalizeMultiPlatformSyncSettings({
      enabled: true,
      port: 9527,
      token: 'abc-123',
      selectedPlatforms: ['zhihu'],
      // legacy data.json without the new flags
    });
    expect(normalized.enabled).toBe(true);
    expect(normalized.port).toBe(9527);
    expect(normalized.token).toBe('abc-123');
    expect(normalized.selectedPlatforms).toContain('zhihu');
    // Critical: a legacy settings file that predates Sprint 1 must NOT
    // accidentally enable remote bind or legacy auth.
    expect(normalized.allowRemote).toBe(false);
    expect(normalized.allowLegacyUnauthenticated).toBe(false);
  });

  it('normalize is idempotent — running it twice yields an equivalent result', () => {
    const once = normalizeMultiPlatformSyncSettings({
      enabled: true,
      port: 12345,
      token: '  trim-me  ',
      allowRemote: true,
      allowLegacyUnauthenticated: false,
    });
    const twice = normalizeMultiPlatformSyncSettings(once);
    expect(twice).toEqual(once);
    expect(twice.token).toBe('trim-me');
  });
});
