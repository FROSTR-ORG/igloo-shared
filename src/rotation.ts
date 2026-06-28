import { nip19 } from 'nostr-tools';

import { getWasmKeysetApi } from './bridge-wasm-runtime';
import { Secret, type Passphrase, type ShareSecretHex } from './secret';
import {
  normalizeHex32,
  publicKeyFromSecret,
  shareWireFromSecret,
} from './browser-profile/core';
import {
  decodeBfProfilePackage,
  decodeBfSharePackage,
  deriveProfileIdFromShareSecret,
  encodeBfOnboardPackage,
  groupPackageToWireValue,
  groupPublicKeyFromPackage,
  type BrowserGroupPackage,
  type BrowserOnboardPackagePayload,
  type BrowserProfilePackagePayload,
} from './profile-package';

type RotatedKeysetBundleExport = {
  previous_group_id: string;
  next_group_id: string;
  next: {
    group: {
      group_pk: string;
      threshold: number;
      members: Array<{ idx: number; pubkey: string }>;
    };
    shares: Array<{ idx: number; seckey: string }>;
  };
};

export type BrowserRotationDraft = {
  sourceGroupId: string;
  nextGroupId: string;
  groupPublicKey: string;
  threshold: number;
  count: number;
  groupName: string;
  members: Array<{ idx: number; pubkey: string }>;
  shares: Array<{
    memberIndex: number;
    shareSecret: ShareSecretHex;
    sharePublicKey: string;
  }>;
};

export type RotationTargetAssignment = {
  memberIndex: number;
  label: string;
  relays: string[];
  intent: 'new_device' | 'rotate_existing_device';
};

export type RotationDistributionArtifact = {
  memberIndex: number;
  intent: 'new_device' | 'rotate_existing_device';
  profileId: string;
  profilePayload: BrowserProfilePackagePayload;
  onboardPackageText: string;
};

export type BrowserRotationSourcePackageKind = 'bfprofile' | 'bfshare';

export type BrowserRotationRecoveredSource = {
  shareSecret: ShareSecretHex;
  relays: string[];
  sharePublicKey: string;
  groupPackage: BrowserGroupPackage | null;
  sourcePackageKind: BrowserRotationSourcePackageKind;
};

function normalizeRelays(relays: string[]) {
  const normalized = relays.map((relay) => relay.trim()).filter(Boolean);
  if (!normalized.length) {
    throw new Error('At least one relay is required.');
  }
  return normalized;
}

function toPassphrase(value: Passphrase | string) {
  return typeof value === 'string' ? Secret.of(value) : value;
}

export async function recoverRotationSourceFromPackage(
  packageText: string,
  password: Passphrase | string,
): Promise<BrowserRotationRecoveredSource> {
  const normalized = packageText.trim();
  if (normalized.startsWith('bfshare1')) {
    const share = await decodeBfSharePackage(normalized, toPassphrase(password));
    const shareSecret = Secret.of(normalizeHex32(share.shareSecret, 'bfshare share secret'));
    return {
      shareSecret,
      relays: normalizeRelays(share.relays),
      sharePublicKey: publicKeyFromSecret(shareSecret.expose()),
      groupPackage: null,
      sourcePackageKind: 'bfshare',
    };
  }

  if (normalized.startsWith('bfprofile1')) {
    const profile = await decodeBfProfilePackage(normalized, toPassphrase(password));
    const shareSecret = Secret.of(normalizeHex32(profile.device.shareSecret, 'bfprofile share secret'));
    return {
      shareSecret,
      relays: normalizeRelays(profile.device.relays),
      sharePublicKey: publicKeyFromSecret(shareSecret.expose()),
      groupPackage: profile.groupPackage,
      sourcePackageKind: 'bfprofile',
    };
  }

  if (normalized.startsWith('bfonboard1')) {
    throw new Error('bfonboard packages are adoption packages. Use bfprofile or bfshare source packages for rotation or recovery.');
  }
  throw new Error('Source package must be a bfprofile1... or bfshare1... package.');
}

/**
 * Map raw share secrets to their `{ idx, seckey }` wire shares within a known
 * group package, deduped by member index. Each secret must belong to the group
 * (otherwise {@link shareWireFromSecret} throws). This is the local replacement
 * for the removed relay-backup fetch: the group context comes from the caller's
 * own profile, not from a relay-published encrypted backup.
 */
function buildDistinctShareWires(groupPackage: BrowserGroupPackage, shareSecrets: ShareSecretHex[]) {
  const byIdx = new Map<number, { idx: number; seckey: string }>();
  for (const secret of shareSecrets) {
    const wire = shareWireFromSecret(groupPackage, secret.expose());
    byIdx.set(wire.idx, wire);
  }
  return [...byIdx.values()];
}

export async function buildRotationDraft(input: {
  groupPackage: BrowserGroupPackage;
  shareSecrets: ShareSecretHex[];
  threshold: number;
  count: number;
  groupName?: string | null;
}) {
  const shares = buildDistinctShareWires(input.groupPackage, input.shareSecrets);
  if (shares.length < input.groupPackage.threshold) {
    throw new Error(`Rotation requires at least ${input.groupPackage.threshold} current shares.`);
  }

  const api = await getWasmKeysetApi();
  const rotated = JSON.parse(
    api.rotate_keyset_bundle(
      JSON.stringify({
        group: groupPackageToWireValue(input.groupPackage),
        shares,
        threshold: input.threshold,
        count: input.count,
      }),
    ),
  ) as RotatedKeysetBundleExport;

  if (
    normalizeHex32(rotated.next.group.group_pk, 'rotated group public key') !==
    groupPublicKeyFromPackage(input.groupPackage)
  ) {
    throw new Error('Rotation changed the group public key.');
  }

  const members = rotated.next.group.members.map((member) => ({
    idx: member.idx,
    pubkey: member.pubkey.toLowerCase(),
  }));

  return {
    sourceGroupId: normalizeHex32(rotated.previous_group_id, 'source group id'),
    nextGroupId: normalizeHex32(rotated.next_group_id, 'next group id'),
    groupPublicKey: normalizeHex32(rotated.next.group.group_pk, 'group public key'),
    threshold: rotated.next.group.threshold,
    count: rotated.next.group.members.length,
    groupName: input.groupName?.trim() || input.groupPackage.groupName,
    members,
    shares: rotated.next.shares.map((share) => {
      const shareSecret = Secret.of(normalizeHex32(share.seckey, 'rotated share secret'));
      return {
        memberIndex: share.idx,
        shareSecret,
        sharePublicKey: publicKeyFromSecret(shareSecret.expose()),
      };
    }),
  } satisfies BrowserRotationDraft;
}

export type BrowserRecoveredKey = {
  nsec: Secret<string>;
  signingKeyHex: Secret<string>;
};

/**
 * Reconstruct the group secret key (nsec) from a set of share secrets and the
 * keyset's group package. Mirrors {@link buildRotationDraft}'s collection, but
 * instead of re-sharing the keyset it returns the reconstructed private key for
 * display. The shares are never persisted; callers own auto-clearing the result.
 */
export async function recoverSecretKeyFromShares(input: {
  groupPackage: BrowserGroupPackage;
  shareSecrets: ShareSecretHex[];
}): Promise<BrowserRecoveredKey> {
  const shares = buildDistinctShareWires(input.groupPackage, input.shareSecrets);
  if (shares.length < input.groupPackage.threshold) {
    throw new Error(`Recovery requires at least ${input.groupPackage.threshold} shares.`);
  }

  const api = await getWasmKeysetApi();
  const signingKeyHex = normalizeHex32(
    api.recover_secret_key_from_shares(
      JSON.stringify({
        group: groupPackageToWireValue(input.groupPackage),
        shares,
      }),
    ),
    'recovered signing key',
  );
  const bytes = new Uint8Array(
    (signingKeyHex.match(/.{2}/g) ?? []).map((byte) => Number.parseInt(byte, 16)),
  );
  try {
    return {
      nsec: Secret.of(nip19.nsecEncode(bytes)),
      signingKeyHex: Secret.of(signingKeyHex),
    };
  } finally {
    bytes.fill(0);
  }
}

export async function buildRotationProfilePayload(
  draft: BrowserRotationDraft,
  assignment: RotationTargetAssignment,
) {
  const share = draft.shares.find((entry) => entry.memberIndex === assignment.memberIndex);
  if (!share) {
    throw new Error(`Rotation draft does not contain member ${assignment.memberIndex}.`);
  }
  const relays = normalizeRelays(assignment.relays);
  const shareSecret = share.shareSecret.expose();
  return {
    profileId: await deriveProfileIdFromShareSecret(shareSecret),
    version: 1,
    device: {
      name: assignment.label.trim(),
      shareSecret,
      manualPeerPolicyOverrides: [],
      relays,
    },
    groupPackage: {
      groupName: draft.groupName,
      groupPk: draft.groupPublicKey,
      threshold: draft.threshold,
      members: draft.members,
    },
  } satisfies BrowserProfilePackagePayload;
}

export async function buildRotationDistributionArtifact(input: {
  draft: BrowserRotationDraft;
  assignment: RotationTargetAssignment;
  packagePassword: string;
  onboardPeerPubkey: string;
}) {
  const payload = await buildRotationProfilePayload(input.draft, input.assignment);
  const peerPubkey = normalizeHex32(input.onboardPeerPubkey, 'rotation onboarding peer pubkey');
  const onboardPackageText = await encodeBfOnboardPackage(
    {
      shareSecret: payload.device.shareSecret,
      relays: payload.device.relays,
      peerPubkey,
    } satisfies BrowserOnboardPackagePayload,
    Secret.of(input.packagePassword),
  );
  return {
    memberIndex: input.assignment.memberIndex,
    intent: input.assignment.intent,
    profileId: payload.profileId,
    profilePayload: payload,
    onboardPackageText,
  } satisfies RotationDistributionArtifact;
}
