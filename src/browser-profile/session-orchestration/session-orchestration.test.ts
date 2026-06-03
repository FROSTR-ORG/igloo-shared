import { describe, expect, test } from 'vitest';

import { completeBrowserProfileSave } from '../../index';

describe('browser-session-orchestration helpers', () => {
  test('returns runtime data when activation succeeds', async () => {
    const result = await completeBrowserProfileSave({
      profile: { id: 'profile-1' },
      autoStart: true,
      activate: async () => ({ active: true }),
    });

    expect(result).toEqual({
      profile: { id: 'profile-1' },
      runtime: { active: true },
      runtimeWarning: null,
    });
  });

  test('returns a non-fatal runtime warning when activation fails', async () => {
    const result = await completeBrowserProfileSave({
      profile: { id: 'profile-2' },
      autoStart: true,
      activate: async () => {
        throw new Error('relay unavailable');
      },
    });

    expect(result.profile).toEqual({ id: 'profile-2' });
    expect(result.runtime).toBeNull();
    expect(result.runtimeWarning).toEqual({
      code: 'runtime_unavailable',
      message: 'Profile saved, but the signer is unavailable. Start it again when relays are reachable.',
      detail: 'relay unavailable',
    });
  });
});
