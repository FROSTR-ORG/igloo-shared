import { getPublicKey, type Event } from 'nostr-tools';

import { getWasmKeysetApi } from './bridge-wasm-runtime';
import {
  createEncryptedProfileBackup,
  deriveProfileIdFromShareSecret,
  encodeBfOnboardPackage,
  type BrowserOnboardPackagePayload,
  groupPublicKeyFromPackage,
  type BrowserProfilePackagePayload,
  type BrowserSharePackagePayload,
  xOnlyFromCompressedPubkey,
} from './profile-package';
import {
  fetchLatestEncryptedProfileBackup,
  publishEncryptedProfileBackup,
  recoverProfileFromSharePackage,
  type BrowserShareRecoveryResult,
} from './profile-backup-host';

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

export type BrowserRotationRecoveredSource = BrowserShareRecoveryResult & {
  groupId: string;
  sharePublicKey: string;
};

export type BrowserRotationDraft = {
  sourceGroupId: string;
  nextGroupId: string;
  groupPublicKey: string;
  threshold: number;
  count: number;
  keysetName: string;
  members: Array<{ idx: number; pubkey: string }>;
  shares: Array<{
    memberIndex: number;
    shareSecret: string;
    sharePublicKey: string;
  }>;
  sourceProfiles: BrowserRotationRecoveredSource[];
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

function normalizeHex32(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Invalid ${label}.`);
  }
  return normalized;
}

function normalizeRelays(relays: string[]) {
  const normalized = relays.map((relay) => relay.trim()).filter(Boolean);
  if (!normalized.length) {
    throw new Error('At least one relay is required.');
  }
  return normalized;
}

function hexToBytes(hex: string) {
  const normalized = normalizeHex32(hex, 'hex string');
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function publicKeyFromSecret(secretHex: string) {
  return getPublicKey(hexToBytes(secretHex)).toLowerCase();
}

function groupJsonFromProfilePayload(payload: BrowserProfilePackagePayload) {
  return JSON.stringify({
    group_pk: payload.groupPackage.groupPk,
    threshold: payload.groupPackage.threshold,
    members: payload.groupPackage.members,
  });
}

function shareJsonFromProfilePayload(payload: BrowserProfilePackagePayload) {
  const sharePublicKey = publicKeyFromSecret(payload.device.shareSecret);
  const member = payload.groupPackage.members.find(
    (candidate) => xOnlyFromCompressedPubkey(candidate.pubkey) === sharePublicKey,
  );
  if (!member) {
    throw new Error('Profile share secret does not match any group member.');
  }
  return JSON.stringify({
    idx: member.idx,
    seckey: payload.device.shareSecret,
  });
}

export async function deriveGroupIdFromProfilePayload(profile: BrowserProfilePackagePayload) {
  const api = await getWasmKeysetApi();
  return api.derive_group_id(groupJsonFromProfilePayload(profile));
}

export async function recoverRotationSourceFromBfshare(
  packageText: string,
  password: string,
  options?: { maxWait?: number },
) {
  const recovered = await recoverProfileFromSharePackage(packageText, password, options);
  return {
    ...recovered,
    groupId: await deriveGroupIdFromProfilePayload(recovered.profile),
    sharePublicKey: publicKeyFromSecret(recovered.share.shareSecret),
  } satisfies BrowserRotationRecoveredSource;
}

export async function buildRotationDraft(input: {
  sources: BrowserRotationRecoveredSource[];
  threshold: number;
  count: number;
  keysetName?: string | null;
}) {
  if (input.sources.length === 0) {
    throw new Error('At least one rotation source is required.');
  }
  const [first, ...rest] = input.sources;
  if (input.sources.length < first.profile.groupPackage.threshold) {
    throw new Error(`Rotation requires at least ${first.profile.groupPackage.threshold} current shares.`);
  }
  for (const source of rest) {
    if (source.groupId !== first.groupId) {
      throw new Error('Rotation sources must all belong to the same current group configuration.');
    }
    if (groupPublicKeyFromPackage(source.profile.groupPackage) !== groupPublicKeyFromPackage(first.profile.groupPackage)) {
      throw new Error('Rotation sources must all belong to the same group public key.');
    }
  }

  const api = await getWasmKeysetApi();
  const rotated = JSON.parse(
    api.rotate_keyset_bundle(
      JSON.stringify({
        group: JSON.parse(groupJsonFromProfilePayload(first.profile)),
        shares: input.sources.map((source) => JSON.parse(shareJsonFromProfilePayload(source.profile))),
        threshold: input.threshold,
        count: input.count,
      }),
    ),
  ) as RotatedKeysetBundleExport;

  if (normalizeHex32(rotated.next.group.group_pk, 'rotated group public key') !== groupPublicKeyFromPackage(first.profile.groupPackage)) {
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
    keysetName: input.keysetName?.trim() || first.profile.keysetName,
    members,
    shares: await Promise.all(
      rotated.next.shares.map(async (share) => ({
        memberIndex: share.idx,
        shareSecret: normalizeHex32(share.seckey, 'rotated share secret'),
        sharePublicKey: publicKeyFromSecret(share.seckey),
      })),
    ),
    sourceProfiles: input.sources,
  } satisfies BrowserRotationDraft;
}

export async function buildRotationDraftFromBfshares(input: {
  sources: Array<{
    packageText: string;
    password: string;
  }>;
  threshold: number;
  count: number;
  keysetName?: string | null;
  maxWait?: number;
}) {
  const recoveredSources = await Promise.all(
    input.sources.map((source) =>
      recoverRotationSourceFromBfshare(source.packageText, source.password, {
        maxWait: input.maxWait,
      }),
    ),
  );
  return await buildRotationDraft({
    sources: recoveredSources,
    threshold: input.threshold,
    count: input.count,
    keysetName: input.keysetName,
  });
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
  return {
    profileId: await deriveProfileIdFromShareSecret(share.shareSecret),
    version: 1,
    keysetName: draft.keysetName,
    device: {
      name: assignment.label.trim(),
      shareSecret: share.shareSecret,
      manualPeerPolicyOverrides: [],
      remotePeerPolicyObservations: [],
      relays,
    },
    groupPackage: {
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
    input.packagePassword,
  );
  return {
    memberIndex: input.assignment.memberIndex,
    intent: input.assignment.intent,
    profileId: payload.profileId,
    profilePayload: payload,
    onboardPackageText,
  } satisfies RotationDistributionArtifact;
}

export async function publishRotationDistributionBackup(payload: BrowserProfilePackagePayload) {
  const backup = await createEncryptedProfileBackup(payload);
  await publishEncryptedProfileBackup({
    relays: payload.device.relays,
    shareSecret: payload.device.shareSecret,
    backup,
  });
}

export async function fetchRotationBackupEvent(input: {
  share: BrowserSharePackagePayload;
  maxWait?: number;
}): Promise<{ event: Event }> {
  const { event } = await fetchLatestEncryptedProfileBackup({
    relays: input.share.relays,
    shareSecret: input.share.shareSecret,
    maxWait: input.maxWait,
  });
  return { event };
}
