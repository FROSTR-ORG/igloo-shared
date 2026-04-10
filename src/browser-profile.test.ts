import { getPublicKey } from 'nostr-tools';
import { describe, expect, test, vi } from 'vitest';

vi.mock('./profile-package', async () => {
  const actual = await vi.importActual<typeof import('./profile-package')>('./profile-package');
  return {
    ...actual,
    deriveProfileIdFromShareSecret: vi.fn(async (shareSecret: string) => `profile-${shareSecret.slice(0, 8)}`),
  };
});

import {
  createBrowserProfileArtifactRefs,
  createBrowserRuntimeProfileSummary,
  createDefaultManualPeerPolicy,
  normalizeGroupMemberSharePublicKey,
  profilePayloadFromRuntimeSnapshot,
  publicKeyFromSecret,
  shareJsonFromPayload,
} from './browser-profile';

function hexToBytes(hex: string) {
  return Uint8Array.from(hex.match(/.{1,2}/g)?.map((value) => Number.parseInt(value, 16)) ?? []);
}

describe('browser-profile helpers', () => {
  test('publicKeyFromSecret matches nostr-tools output', () => {
    const shareSecret = '11'.repeat(32);
    const expected = getPublicKey(hexToBytes(shareSecret)).toLowerCase();
    expect(publicKeyFromSecret(shareSecret)).toBe(expected);
  });

  test('normalizeGroupMemberSharePublicKey accepts x-only and compressed forms', () => {
    const xonly = '22'.repeat(32);
    expect(normalizeGroupMemberSharePublicKey(xonly)).toBe(xonly);
    expect(normalizeGroupMemberSharePublicKey(`02${xonly}`)).toBe(xonly);
    expect(() => normalizeGroupMemberSharePublicKey('bad')).toThrow('Invalid group member share public key.');
  });

  test('shareJsonFromPayload chooses the matching group member for the local share', () => {
    const shareSecret = '11'.repeat(32);
    const sharePubkey = publicKeyFromSecret(shareSecret);
    const payload = {
      profileId: 'profile-1',
      version: 1,
      device: {
        name: 'Device 1',
        shareSecret,
        manualPeerPolicyOverrides: [],
        relays: ['ws://127.0.0.1:4848'],
      },
      groupPackage: {
        groupName: 'Group 1',
        groupPk: '33'.repeat(32),
        threshold: 2,
        members: [
          { idx: 7, pubkey: `02${sharePubkey}` },
          { idx: 8, pubkey: `03${'44'.repeat(32)}` },
        ],
      },
    };

    expect(JSON.parse(shareJsonFromPayload(payload))).toEqual({
      idx: 7,
      seckey: shareSecret,
    });
  });

  test('profilePayloadFromRuntimeSnapshot normalizes members and default policies', async () => {
    const shareSecret = '11'.repeat(32);
    const localSharePubkey = publicKeyFromSecret(shareSecret);
    const remoteXonly = '22'.repeat(32);

    const payload = await profilePayloadFromRuntimeSnapshot({
      label: ' Restored Device ',
      relays: ['ws://127.0.0.1:4848'],
      runtimeSnapshotJson: JSON.stringify({
        bootstrap: {
          group: {
            group_pk: '33'.repeat(32),
            threshold: 2,
            members: [
              { idx: 1, pubkey: localSharePubkey },
              { idx: 2, pubkey: `03${remoteXonly}` },
            ],
          },
          share: {
            seckey: shareSecret,
          },
        },
      }),
    });

    expect(payload.profileId).toBe('profile-11111111');
    expect(payload.device.name).toBe('Restored Device');
    expect(payload.groupPackage.groupName).toBe('Restored Device');
    expect(payload.groupPackage.members).toEqual([
      { idx: 1, pubkey: `02${localSharePubkey}` },
      { idx: 2, pubkey: `03${remoteXonly}` },
    ]);
    expect(payload.device.manualPeerPolicyOverrides).toEqual([
      {
        pubkey: remoteXonly,
        policy: createDefaultManualPeerPolicy(),
      },
    ]);
  });

  test('createBrowserRuntimeProfileSummary normalizes relays, peer pubkey, and runtime snapshot', () => {
    const payload = {
      profileId: 'profile-1',
      version: 1,
      device: {
        name: ' Device 1 ',
        shareSecret: '11'.repeat(32),
        manualPeerPolicyOverrides: [],
        relays: ['wss://relay.primal.net', 'not-a-relay'],
      },
      groupPackage: {
        groupName: ' Group 1 ',
        groupPk: '33'.repeat(32),
        threshold: 2,
        members: [{ idx: 1, pubkey: `02${publicKeyFromSecret('11'.repeat(32))}` }],
      },
    };

    expect(
      createBrowserRuntimeProfileSummary({
        payload,
        peerPubkey: ` ${'AA'.repeat(32)} `,
        runtimeSnapshotJson: '  {"state":"ok"}  ',
      }),
    ).toEqual(
      expect.objectContaining({
        id: 'profile-1',
        label: 'Device 1',
        groupName: 'Group 1',
        relays: ['wss://relay.primal.net'],
        groupPublicKey: '33'.repeat(32),
        publicKey: '33'.repeat(32),
        sharePublicKey: publicKeyFromSecret('11'.repeat(32)),
        peerPubkey: 'aa'.repeat(32),
        runtimeSnapshotJson: '  {"state":"ok"}  ',
      }),
    );
  });

  test('createBrowserProfileArtifactRefs uses the shared browser-profile namespace', () => {
    expect(createBrowserProfileArtifactRefs('Profile-1')).toEqual({
      groupRef: 'browser-profile:profile-1:group',
      encryptedProfileRef: 'browser-profile:profile-1:encrypted-profile',
      statePath: 'browser-profile:profile-1:state',
    });
  });
});
