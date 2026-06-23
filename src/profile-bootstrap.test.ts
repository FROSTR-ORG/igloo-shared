import { getPublicKey } from 'nostr-tools';
import { describe, expect, test } from 'vitest';

import { buildProfileBootstrap } from './profile-bootstrap';
import { hexToBytes } from './runtime-internal';

const shareSecret = '11'.repeat(32);
const localSharePubkey = getPublicKey(hexToBytes(shareSecret)).toLowerCase();
const peerA = '22'.repeat(32);
const peerBCompressed = `02${'33'.repeat(32)}`;
const groupPublicKey = '44'.repeat(32);

describe('buildProfileBootstrap', () => {
  test('builds bootstrap state and derived group identity from profile packages', () => {
    const result = buildProfileBootstrap({
      groupPackageJson: JSON.stringify({
        group_pk: groupPublicKey.toUpperCase(),
        threshold: 2,
        members: [
          { idx: 1, pubkey: localSharePubkey.toUpperCase() },
          { idx: 2, pubkey: peerA },
          { idx: 3, pubkey: peerBCompressed },
        ],
      }),
      sharePackageJson: JSON.stringify({
        idx: 1.9,
        seckey: shareSecret.toUpperCase(),
      }),
    });

    expect(result.shareSecret).toBe(shareSecret);
    expect(result.localSharePubkey32).toBe(localSharePubkey);
    expect(result.groupPubkey32).toBe(groupPublicKey);
    expect(result.peerPubkeys32).toEqual([peerA, '33'.repeat(32)]);
    expect(result.xonlyToPeer32Entries).toEqual([
      [localSharePubkey, localSharePubkey],
      [peerA, peerA],
      ['33'.repeat(32), '33'.repeat(32)],
    ]);
    expect(result.bootstrap).toEqual({
      group: {
        group_pk: groupPublicKey.toUpperCase(),
        threshold: 2,
        members: [
          { idx: 1, pubkey: localSharePubkey.toUpperCase() },
          { idx: 2, pubkey: peerA },
          { idx: 3, pubkey: peerBCompressed },
        ],
      },
      share: {
        idx: 1,
        seckey: shareSecret,
      },
      peers: [peerA, '33'.repeat(32)],
      initial_peer_nonces: [],
    });
  });

  test('rejects missing, malformed, and invalid profile package input', () => {
    expect(() => buildProfileBootstrap({ groupPackageJson: '', sharePackageJson: '{}' })).toThrow(
      'Missing group package for profile runtime bootstrap',
    );
    expect(() =>
      buildProfileBootstrap({ groupPackageJson: '{', sharePackageJson: '{}' }),
    ).toThrow('Invalid profile bootstrap package JSON');
    expect(() =>
      buildProfileBootstrap({ groupPackageJson: JSON.stringify({ members: [] }), sharePackageJson: '{}' }),
    ).toThrow('Invalid share package for profile runtime bootstrap');
    expect(() =>
      buildProfileBootstrap({
        groupPackageJson: JSON.stringify({ group_pk: groupPublicKey, threshold: 1, members: [] }),
        sharePackageJson: JSON.stringify({ seckey: 'not-hex' }),
      }),
    ).toThrow('Invalid share secret');
  });
});
