import { describe, expect, test, vi } from 'vitest';

const {
  createProfilePackagePair,
  decodeBfSharePackage,
  encodeBfOnboardPackage,
  createEncryptedProfileBackup,
  publishEncryptedProfileBackup,
  runtimePayloadFromSnapshot,
} = vi.hoisted(() => ({
  createProfilePackagePair: vi.fn(async () => ({
    profileString: 'bfprofile1connected',
    shareString: 'bfshare1connected',
  })),
  decodeBfSharePackage: vi.fn(async () => ({
    shareSecret: '44'.repeat(32),
    relays: ['wss://source-relay.example'],
  })),
  encodeBfOnboardPackage: vi.fn(async () => 'bfonboard1sponsored'),
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
    decodeBfSharePackage,
    encodeBfOnboardPackage,
    createEncryptedProfileBackup,
  };
});

vi.mock('./profile-backup-host', () => ({
  publishEncryptedProfileBackup,
}));

vi.mock('./browser-profile/runtime-session', async () => {
  const actual = await vi.importActual<typeof import('./browser-profile/runtime-session')>('./browser-profile/runtime-session');
  return {
    ...actual,
    runtimePayloadFromSnapshot,
  };
});

import {
  createBrowserOnboardingConnection,
  createBrowserOnboardSponsorshipPackage,
  createBrowserOnboardSponsorshipPackageFromBfshare,
  finalizeConnectedBrowserProfile,
  finalizeRotatedBrowserProfile,
  getBrowserOnboardSponsorshipReadiness,
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

  test('reports saved-profile sponsorship as unavailable without a package producer', () => {
    expect(getBrowserOnboardSponsorshipReadiness()).toEqual({
      available: false,
      reason: 'saved-profile-local-share-only',
      missing: 'remote-share-package-producer',
      securityBoundary: 'saved-browser-profiles-retain-local-share-only',
      requiredSource: 'nsec-or-threshold-source-shares',
      safeActions: [
        'export-local-share-as-source',
        'use-create-or-rotate-before-setup-finishes',
        'replace-share-from-prepared-package',
      ],
    });
  });

  test('reports sponsorship as available only with a package producer', () => {
    expect(
      getBrowserOnboardSponsorshipReadiness({
        packageProducerAvailable: true,
      }),
    ).toEqual({
      available: true,
      mode: 'package-producer',
      requiredSource: 'package-producer',
      safeActions: ['configure-device'],
    });
  });

  test('keeps the first-draft runtime package producer flag as a compatibility alias', () => {
    expect(
      getBrowserOnboardSponsorshipReadiness({
        runtimePackageProducerAvailable: true,
      }),
    ).toEqual({
      available: true,
      mode: 'package-producer',
      requiredSource: 'package-producer',
      safeActions: ['configure-device'],
    });
  });

  test('reports sponsorship as available with explicit source-share package material', () => {
    expect(
      getBrowserOnboardSponsorshipReadiness({
        sourceSharePackageProducerAvailable: true,
      }),
    ).toEqual({
      available: true,
      mode: 'source-share-package-producer',
      requiredSource: 'nsec-or-threshold-source-shares',
      safeActions: ['configure-device'],
    });
  });

  test('creates a sponsorship package from explicit remote share source material', async () => {
    const shareSecret = '44'.repeat(32);
    const sharePubkey = publicKeyFromSecret(shareSecret);

    const result = await createBrowserOnboardSponsorshipPackage({
      label: '  Remote Device  ',
      groupPackage: {
        groupName: 'My Signing Key',
        groupPk: '22'.repeat(32),
        threshold: 2,
        members: [{ idx: 2, pubkey: `02${sharePubkey}` }],
      },
      memberIdx: 2,
      shareSecret,
      relays: [' wss://relay.primal.net/ '],
      peerPubkey: 'aa'.repeat(32),
      password: 'package-pass',
    });

    expect(encodeBfOnboardPackage).toHaveBeenCalledWith(
      {
        shareSecret,
        relays: ['wss://relay.primal.net'],
        peerPubkey: 'aa'.repeat(32),
      },
      'package-pass',
    );
    expect(result).toEqual(
      expect.objectContaining({
        memberIdx: 2,
        label: 'Remote Device',
        packageText: 'bfonboard1sponsored',
      }),
    );
    expect(result.preview).toEqual(
      expect.objectContaining({
        label: 'Remote Device',
        share_public_key: sharePubkey,
        group_public_key: '22'.repeat(32),
        relays: ['wss://relay.primal.net'],
        source: 'bfonboard',
      }),
    );
    expect(JSON.parse(result.preview.share_package_json)).toEqual({
      idx: 2,
      seckey: shareSecret,
    });
    expect(JSON.parse(result.preview.group_package_json)).toEqual(
      expect.objectContaining({
        group_name: 'My Signing Key',
        group_pk: '22'.repeat(32),
        threshold: 2,
      }),
    );
  });

  test('rejects sponsorship when the source share does not match the target group member', async () => {
    await expect(
      createBrowserOnboardSponsorshipPackage({
        label: 'Remote Device',
        groupPackage: {
          groupName: 'My Signing Key',
          groupPk: '22'.repeat(32),
          threshold: 2,
          members: [{ idx: 2, pubkey: `02${publicKeyFromSecret('55'.repeat(32))}` }],
        },
        memberIdx: 2,
        shareSecret: '44'.repeat(32),
        relays: ['wss://relay.primal.net'],
        peerPubkey: 'aa'.repeat(32),
        password: 'package-pass',
      }),
    ).rejects.toThrow('Sponsorship share does not match member #2');
  });

  test('creates a sponsorship package by decoding explicit bfshare source material', async () => {
    const shareSecret = '44'.repeat(32);
    const sharePubkey = publicKeyFromSecret(shareSecret);

    const result = await createBrowserOnboardSponsorshipPackageFromBfshare({
      label: 'Remote Device',
      groupPackage: {
        groupName: 'My Signing Key',
        groupPk: '22'.repeat(32),
        threshold: 2,
        members: [
          { idx: 1, pubkey: `02${publicKeyFromSecret('11'.repeat(32))}` },
          { idx: 2, pubkey: `02${sharePubkey}` },
        ],
      },
      sourcePackageText: '  bfshare1remote  ',
      sourcePackagePassword: 'source-pass',
      relays: ['wss://relay.primal.net'],
      peerPubkey: 'aa'.repeat(32),
      password: 'package-pass',
    });

    expect(decodeBfSharePackage).toHaveBeenCalledWith('bfshare1remote', 'source-pass');
    expect(encodeBfOnboardPackage).toHaveBeenCalledWith(
      {
        shareSecret,
        relays: ['wss://relay.primal.net'],
        peerPubkey: 'aa'.repeat(32),
      },
      'package-pass',
    );
    expect(result.memberIdx).toBe(2);
    expect(result.preview.share_public_key).toBe(sharePubkey);
    expect(JSON.parse(result.preview.share_package_json)).toEqual({
      idx: 2,
      seckey: shareSecret,
    });
  });

  test('rejects a bfshare source that does not belong to the selected keyset', async () => {
    await expect(
      createBrowserOnboardSponsorshipPackageFromBfshare({
        label: 'Remote Device',
        groupPackage: {
          groupName: 'My Signing Key',
          groupPk: '22'.repeat(32),
          threshold: 2,
          members: [{ idx: 2, pubkey: `02${publicKeyFromSecret('55'.repeat(32))}` }],
        },
        sourcePackageText: 'bfshare1remote',
        sourcePackagePassword: 'source-pass',
        relays: ['wss://relay.primal.net'],
        peerPubkey: 'aa'.repeat(32),
        password: 'package-pass',
      }),
    ).rejects.toThrow('Source bfshare does not match any member in this keyset.');
  });
});
