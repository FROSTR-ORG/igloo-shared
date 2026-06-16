import { describe, expect, test, vi } from 'vitest';

const { createProfilePackagePair } = vi.hoisted(() => ({
  createProfilePackagePair: vi.fn(async () => ({
    profileString: 'bfprofile1saved',
    shareString: 'bfshare1saved',
  })),
}));

vi.mock('../../profile-package', async () => {
  const actual = await vi.importActual<typeof import('../../profile-package')>('../../profile-package');
  return {
    ...actual,
    createProfilePackagePair,
  };
});

import {
  createBrowserPersistedProfileBundle,
  createFinalizedBrowserStoredProfile,
  publicKeyFromSecret,
} from '../../index';

describe('browser-profile-persistence helpers', () => {
  test('creates the persisted profile bundle', async () => {
    const payload = {
      profileId: 'profile-1',
      version: 1,
      device: {
        name: 'Saved Device',
        shareSecret: '11'.repeat(32),
        manualPeerPolicyOverrides: [],
        relays: ['ws://relay-1'],
      },
      groupPackage: {
        groupName: 'Saved Group',
        groupPk: '22'.repeat(32),
        threshold: 2,
        members: [{ idx: 1, pubkey: `02${publicKeyFromSecret('11'.repeat(32))}` }],
      },
    };

    const bundle = await createBrowserPersistedProfileBundle({
      payload,
      password: 'secret',
      source: 'bfprofile',
    });

    expect(bundle.profileString).toBe('bfprofile1saved');
    expect(bundle.shareString).toBe('bfshare1saved');
    expect(bundle.projection.summary.id).toBe('profile-1');
    const calls = createProfilePackagePair.mock.calls as unknown as unknown[][];
    expect(calls[0]![0]).toEqual(payload);
    expect((calls[0]![1] as { expose: () => string }).expose()).toBe('secret');
  });

  test('rejects duplicate profile ids before returning the bundle', async () => {
    const payload = {
      profileId: 'profile-dup',
      version: 1,
      device: {
        name: 'Saved Device',
        shareSecret: '11'.repeat(32),
        manualPeerPolicyOverrides: [],
        relays: ['ws://relay-1'],
      },
      groupPackage: {
        groupName: 'Saved Group',
        groupPk: '22'.repeat(32),
        threshold: 2,
        members: [{ idx: 1, pubkey: `02${publicKeyFromSecret('11'.repeat(32))}` }],
      },
    };

    await expect(
      createBrowserPersistedProfileBundle({
        payload,
        password: 'secret',
        source: 'generated',
        existingProfileIds: ['profile-dup'],
      }),
    ).rejects.toThrow('Device profile Saved Device (profile-) already exists.');
  });

  test('creates the finalized shared stored-profile record shape', async () => {
    const payload = {
      profileId: 'profile-final',
      version: 1,
      device: {
        name: 'Saved Device',
        shareSecret: '11'.repeat(32),
        manualPeerPolicyOverrides: [],
        relays: ['ws://relay-1'],
      },
      groupPackage: {
        groupName: 'Saved Group',
        groupPk: '22'.repeat(32),
        threshold: 2,
        members: [{ idx: 1, pubkey: `02${publicKeyFromSecret('11'.repeat(32))}` }],
      },
    };

    const finalized = await createFinalizedBrowserStoredProfile({
      payload,
      password: 'secret',
      source: 'bfprofile',
    });

    expect(finalized).toEqual(
      expect.objectContaining({
        source: 'bfprofile',
        storedPassword: 'secret',
        profileString: 'bfprofile1saved',
        shareString: 'bfshare1saved',
      }),
    );
    expect(finalized.summary.id).toBe('profile-final');
    expect(finalized.artifactRefs.encryptedProfileRef).toContain('profile-final');
  });
});
