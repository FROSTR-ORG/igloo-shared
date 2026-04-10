import { describe, expect, test, vi } from 'vitest';

const {
  createProfilePackagePair,
  decodeBfProfilePackage,
  recoverProfileFromSharePackage,
} = vi.hoisted(() => ({
  createProfilePackagePair: vi.fn(async () => ({
    profileString: 'bfprofile1saved',
    shareString: 'bfshare1saved',
  })),
  decodeBfProfilePackage: vi.fn(async () => ({} as any)),
  recoverProfileFromSharePackage: vi.fn(async () => ({ profile: {} as any })),
}));

vi.mock('./profile-package', async () => {
  const actual = await vi.importActual<typeof import('./profile-package')>('./profile-package');
  return {
    ...actual,
    createProfilePackagePair,
    decodeBfProfilePackage,
  };
});

vi.mock('./profile-backup-host', () => ({
  recoverProfileFromSharePackage,
}));

import {
  importAndSaveBrowserProfilePackage,
  importBrowserProfilePackage,
  recoverAndSaveBrowserProfilePackage,
  recoverBrowserProfilePackage,
} from './browser-profile-recovery';
import { publicKeyFromSecret } from './index';

const payload = {
  profileId: 'profile-1',
  version: 1,
  device: {
    name: 'Device 1',
    shareSecret: '11'.repeat(32),
    manualPeerPolicyOverrides: [],
    relays: ['ws://relay-1'],
  },
  groupPackage: {
    groupName: 'Group 1',
    groupPk: '33'.repeat(32),
    threshold: 2,
    members: [{ idx: 1, pubkey: `02${publicKeyFromSecret('11'.repeat(32))}` }],
  },
};

describe('browser-profile-recovery orchestration', () => {
  test('importBrowserProfilePackage returns a shared bfprofile import bundle', async () => {
    decodeBfProfilePackage.mockResolvedValue(payload);

    const imported = await importBrowserProfilePackage('  bfprofile  ', 'secret');

    expect(decodeBfProfilePackage).toHaveBeenCalledWith('bfprofile', 'secret');
    expect(imported).toEqual(
      expect.objectContaining({
        source: 'bfprofile',
        payload,
        profileString: 'bfprofile',
        shareString: 'bfshare1saved',
      }),
    );
  });

  test('recoverBrowserProfilePackage returns a shared bfshare recovery bundle', async () => {
    recoverProfileFromSharePackage.mockResolvedValue({ profile: payload });

    const recovered = await recoverBrowserProfilePackage('  bfshare  ', 'secret');

    expect(recoverProfileFromSharePackage).toHaveBeenCalledWith('bfshare', 'secret');
    expect(recovered).toEqual(
      expect.objectContaining({
        source: 'bfshare',
        payload,
        profileString: 'bfprofile1saved',
        shareString: 'bfshare',
      }),
    );
  });

  test('imports, stores, and activates a profile through shared orchestration', async () => {
    const saved = await importAndSaveBrowserProfilePackage({
      packageText: 'bfprofile1test',
      password: 'secret',
      autoStart: true,
      storeProfile: async ({ imported }) => ({ id: imported.payload.profileId }),
      activate: async () => ({ active: true }),
    });

    expect(saved).toEqual({
      profile: { id: 'profile-1' },
      runtime: { active: true },
      runtimeWarning: null,
    });
  });

  test('recovers, stores, and returns a warning when activation fails', async () => {
    const saved = await recoverAndSaveBrowserProfilePackage({
      packageText: 'bfshare1test',
      password: 'secret',
      autoStart: true,
      storeProfile: async ({ recovered }) => ({ id: recovered.payload.profileId }),
      activate: async () => {
        throw new Error('runtime offline');
      },
    });

    expect(saved.profile).toEqual({ id: 'profile-1' });
    expect(saved.runtime).toBeNull();
    expect(saved.runtimeWarning).toEqual(
      expect.objectContaining({
        code: 'runtime_unavailable',
        detail: 'runtime offline',
      }),
    );
  });
});
