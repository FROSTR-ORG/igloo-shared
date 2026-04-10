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
  saveBrowserProfileAndMaybeActivate,
  saveConnectedBrowserProfileAndMaybeActivate,
  saveImportedBrowserProfileAndMaybeActivate,
  saveRecoveredBrowserProfileAndMaybeActivate,
  saveRotatedBrowserProfileAndMaybeActivate,
} from './browser-profile-save';
import { publicKeyFromSecret } from './index';
import { groupPackageToWireJson, sharePackageToWireJson } from './profile-package';

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

describe('browser-profile-save helpers', () => {
  test('wraps low-level save and activation results', async () => {
    const result = await saveBrowserProfileAndMaybeActivate({
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

  test('imports, finalizes, persists, and activates a profile', async () => {
    decodeBfProfilePackage.mockResolvedValue(payload);

    const saved = await saveImportedBrowserProfileAndMaybeActivate({
      packageText: 'bfprofile1test',
      password: 'secret',
      autoStart: true,
      persistProfile: async ({ imported, finalized }) => ({
        id: imported.payload.profileId,
        source: finalized.source,
      }),
      activate: async () => ({ active: true }),
    });

    expect(saved).toEqual({
      profile: { id: 'profile-1', source: 'bfprofile' },
      runtime: { active: true },
      runtimeWarning: null,
    });
  });

  test('recovers, finalizes, and returns a runtime warning when activation fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    recoverProfileFromSharePackage.mockResolvedValue({ profile: payload });

    const saved = await saveRecoveredBrowserProfileAndMaybeActivate({
      packageText: 'bfshare1test',
      password: 'secret',
      autoStart: true,
      persistProfile: async ({ recovered, finalized }) => ({
        id: recovered.payload.profileId,
        source: finalized.source,
      }),
      activate: async () => {
        throw new Error('runtime offline');
      },
    });

    expect(saved.profile).toEqual({ id: 'profile-1', source: 'bfshare' });
    expect(saved.runtime).toBeNull();
    expect(saved.runtimeWarning).toEqual(
      expect.objectContaining({
        code: 'runtime_unavailable',
        detail: 'runtime offline',
      }),
    );
    const event = JSON.parse(String(warnSpy.mock.calls.at(-1)?.[0] ?? '{}'));
    expect(event).toEqual(
      expect.objectContaining({
        domain: 'profile',
        event: 'activate_runtime_unavailable',
        stage: 'activate',
        warning_code: 'runtime_unavailable',
        warning_detail: 'runtime offline',
      }),
    );
    warnSpy.mockRestore();
  });

  test('finalizes and persists a connected onboarding profile', async () => {
    const saved = await saveConnectedBrowserProfileAndMaybeActivate({
      profilePayload: payload,
      label: 'Connected Device',
      password: 'secret',
      persistProfile: async ({ finalized }) => ({
        id: finalized.summary.id,
        label: finalized.summary.label,
      }),
    });

    expect(saved).toEqual({
      profile: { id: 'profile-1', label: 'Connected Device' },
      runtime: null,
      runtimeWarning: null,
    });
  });

  test('finalizes and persists a rotated profile with the target signer settings path', async () => {
    const saved = await saveRotatedBrowserProfileAndMaybeActivate({
      targetProfile: {
        id: 'current-profile',
        label: 'Current Device',
        relays: ['ws://relay-1'],
        groupPackageJson: groupPackageToWireJson(payload.groupPackage),
        sharePackageJson: sharePackageToWireJson(1, payload.device.shareSecret),
        manualPeerPolicyOverrides: [],
        storedPassword: 'secret',
        runtimeSnapshotJson: '{"snapshot":true}',
        peerPubkey: 'peer-1',
      },
      connectedProfilePayload: {
        ...payload,
        profileId: 'profile-2',
      },
      signerSettings: { sign_timeout_secs: 99 },
      persistProfile: async ({ finalized }) => ({
        id: finalized.summary.id,
        persistedId: finalized.storedPayload.profile.profileId,
        label: finalized.summary.label,
        signerTimeout: finalized.storedPayload.signerSettings.sign_timeout_secs,
      }),
    });

    expect(saved).toEqual({
      profile: {
        id: 'profile-2',
        persistedId: 'profile-2',
        label: 'Current Device',
        signerTimeout: 99,
      },
      runtime: null,
      runtimeWarning: null,
    });
  });

  test('emits a structured error event when import decoding fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    decodeBfProfilePackage.mockRejectedValueOnce(new Error('bad package'));

    await expect(
      saveImportedBrowserProfileAndMaybeActivate({
        packageText: 'bfprofile1bad',
        password: 'secret',
        persistProfile: async () => ({ id: 'never' }),
      }),
    ).rejects.toThrow(/bad package/);

    const event = JSON.parse(String(errorSpy.mock.calls.at(-1)?.[0] ?? '{}'));
    expect(event).toEqual(
      expect.objectContaining({
        domain: 'profile',
        event: 'decode_failed',
        flow_kind: 'bfprofile',
        stage: 'decode',
        error_message: 'bad package',
      }),
    );
    errorSpy.mockRestore();
  });

  test('emits a structured error event when finalized profile persistence fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    decodeBfProfilePackage.mockResolvedValue(payload);

    await expect(
      saveImportedBrowserProfileAndMaybeActivate({
        packageText: 'bfprofile1persist-fail',
        password: 'secret',
        persistProfile: async () => {
          throw new Error('persist exploded');
        },
      }),
    ).rejects.toThrow(/persist exploded/);

    const event = JSON.parse(String(errorSpy.mock.calls.at(-1)?.[0] ?? '{}'));
    expect(event).toEqual(
      expect.objectContaining({
        domain: 'profile',
        event: 'persist_failed',
        flow_kind: 'bfprofile',
        stage: 'persist',
        profile_id: 'profile-1',
        error_message: 'persist exploded',
      }),
    );
    errorSpy.mockRestore();
  });
});
