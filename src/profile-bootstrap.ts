import { getPublicKey } from 'nostr-tools';

import {
  hexToBytes,
  isRecord,
  normalizeHex32,
  normalizePubkey32Hex,
} from './runtime-internal';
import type { GroupPackageWire, RuntimeBootstrapWire } from './wire';

export type ProfileBootstrapBuildInput = {
  groupPackageJson?: string;
  sharePackageJson?: string;
};

export type BuiltProfileBootstrap = {
  bootstrap: RuntimeBootstrapWire;
  shareSecret: string;
  localSharePubkey32: string;
  groupPubkey32: string;
  peerPubkeys32: string[];
  xonlyToPeer32Entries: Array<[string, string]>;
};

export function buildProfileBootstrap({
  groupPackageJson,
  sharePackageJson,
}: ProfileBootstrapBuildInput): BuiltProfileBootstrap {
  if (typeof groupPackageJson !== 'string' || !groupPackageJson.trim()) {
    throw new Error('Missing group package for profile runtime bootstrap');
  }
  if (typeof sharePackageJson !== 'string' || !sharePackageJson.trim()) {
    throw new Error('Missing share package for profile runtime bootstrap');
  }

  let group: GroupPackageWire;
  let share: { idx?: number; seckey?: string };
  try {
    group = JSON.parse(groupPackageJson) as GroupPackageWire;
    share = JSON.parse(sharePackageJson) as { idx?: number; seckey?: string };
  } catch {
    throw new Error('Invalid profile bootstrap package JSON');
  }

  if (!isRecord(group) || !Array.isArray(group.members)) {
    throw new Error('Invalid group package for profile runtime bootstrap');
  }
  if (!isRecord(share) || typeof share.seckey !== 'string') {
    throw new Error('Invalid share package for profile runtime bootstrap');
  }

  const shareSecret = normalizeHex32(share.seckey, 'share secret');
  const localSharePubkey32 = normalizePubkey32Hex(
    getPublicKey(hexToBytes(shareSecret)),
    'share public key',
  );
  const groupPubkey32 = normalizePubkey32Hex(group.group_pk, 'group public key');
  const allPeerPubkeys32 = group.members.map((member) =>
    normalizePubkey32Hex(member.pubkey, `group member ${member.idx} pubkey`),
  );
  const peerPubkeys32 = allPeerPubkeys32.filter((pubkey) => pubkey !== localSharePubkey32);

  return {
    shareSecret,
    localSharePubkey32,
    groupPubkey32,
    peerPubkeys32,
    xonlyToPeer32Entries: allPeerPubkeys32.map((peer32) => [peer32, peer32]),
    bootstrap: {
      group,
      share: {
        idx: typeof share.idx === 'number' ? Math.trunc(share.idx) : 0,
        seckey: shareSecret,
      },
      peers: peerPubkeys32,
      initial_peer_nonces: [],
    },
  };
}
