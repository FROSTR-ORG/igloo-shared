import { describe, expect, test, vi } from 'vitest';

const {
  createProfilePackagePair,
  createEncryptedProfileBackup,
  publishEncryptedProfileBackup,
  runtimePayloadFromSnapshot,
} = vi.hoisted(() => ({
  createProfilePackagePair: vi.fn(async () => ({
    profileString: 'bfprofile1connected',
    shareString: 'bfshare1connected',
  })),
  createEncryptedProfileBackup: vi.fn(async () => ({ version: 1 })),
  publishEncryptedProfileBackup: vi.fn(async () => ({ id: 'backup-event' })),
  runtimePayloadFromSnapshot: vi.fn(async () => ({
    profileId: 'connected-profile',
    version: 1,
    device: {
      name: 'Onboarded Device',
      shareSecret: '11'.repeat(32),
      manualPeerPolicyOverrides: [],
      relays: ['ws://relay-1'],
    },
    groupPackage: {
      groupName: 'Onboarded Device',
      groupPk: '22'.repeat(32),
      threshold: 2,
      members: [],
    },
  })),
}));

vi.mock('./profile-package', async () => {
  const actual = await vi.importActual<typeof import('./profile-package')>('./profile-package');
  return {
    ...actual,
    createProfilePackagePair,
    createEncryptedProfileBackup,
  };
});

vi.mock('./profile-backup-host', () => ({
  publishEncryptedProfileBackup,
}));

vi.mock('./browser-runtime-session', async () => {
  const actual = await vi.importActual<typeof import('./browser-runtime-session')>('./browser-runtime-session');
  return {
    ...actual,
    runtimePayloadFromSnapshot,
  };
});

import {
  createBrowserOnboardingConnection,
  finalizeConnectedBrowserProfile,
  finalizeRotatedBrowserProfile,
  publicKeyFromSecret,
} from './index';

describe('browser-onboarding helpers', () => {
  test('createBrowserOnboardingConnection returns the canonical shared connection bundle', async () => {
    const connection = await createBrowserOnboardingConnection({
      packageText: '  bfonboard1demo  ',
      password: 'secret',
      label: 'Onboarded Device',
      relays: ['ws://relay-1'],
      runtimeSnapshotJson: '{"state":"ok"}',
      peerPubkey: 'aa'.repeat(32),
    });

    expect(connection).toEqual(
      expect.objectContaining({
        packageText: 'bfonboard1demo',
        storedPassword: 'secret',
        profileString: 'bfprofile1connected',
        shareString: 'bfshare1connected',
        peerPubkey: 'aa'.repeat(32),
      }),
    );
  });

  test('finalizeConnectedBrowserProfile returns a finalized shared record', async () => {
    const connection = await createBrowserOnboardingConnection({
      packageText: 'bfonboard1demo',
      password: 'secret',
      label: 'Onboarded Device',
      relays: ['ws://relay-1'],
      runtimeSnapshotJson: '{"state":"ok"}',
    });

    const finalized = await finalizeConnectedBrowserProfile({
      connection,
      label: 'Saved Device',
      password: 'secret',
    });

    expect(finalized.preview.label).toBe('Saved Device');
    expect(finalized.onboardingPackage).toBe('bfonboard1demo');
  });

  test('finalizeRotatedBrowserProfile preserves the target label and filters the replaced id', async () => {
    const connection = await createBrowserOnboardingConnection({
      packageText: 'bfonboard1demo',
      password: 'secret',
      label: 'Onboarded Device',
      relays: ['ws://relay-1'],
      runtimeSnapshotJson: '{"state":"ok"}',
    });

    const finalized = await finalizeRotatedBrowserProfile({
      targetProfile: {
        id: 'old-profile',
        label: 'Primary Browser Device',
        relays: ['ws://relay-1'],
        groupPackageJson: JSON.stringify({
          group_name: 'Group 1',
          group_pk: '22'.repeat(32),
          threshold: 2,
          members: [{ idx: 1, pubkey: `02${publicKeyFromSecret('11'.repeat(32))}` }],
        }),
        sharePackageJson: JSON.stringify({
          idx: 1,
          seckey: '33'.repeat(32),
        }),
        manualPeerPolicyOverrides: [],
        storedPassword: 'secret',
      },
      connection,
      existingProfileIds: ['old-profile', 'other-profile'],
    });

    expect(finalized.preview.label).toBe('Primary Browser Device');
    expect(finalized.summary.id).toBe('connected-profile');
  });
});
