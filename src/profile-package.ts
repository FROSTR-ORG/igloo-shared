import type { Event } from 'nostr-tools';

import { getWasmProfilePackageApi } from './bridge-wasm-runtime';

export type BrowserProtectedPackageKind = 'bfprofile' | 'bfshare' | 'bfonboard';

export type BrowserPolicyOverrideValue = 'unset' | 'allow' | 'deny';

export type BrowserMethodPolicy = {
  echo: boolean;
  ping: boolean;
  onboard: boolean;
  sign: boolean;
  ecdh: boolean;
};

export type BrowserMethodPolicyOverride = {
  echo: BrowserPolicyOverrideValue;
  ping: BrowserPolicyOverrideValue;
  onboard: BrowserPolicyOverrideValue;
  sign: BrowserPolicyOverrideValue;
  ecdh: BrowserPolicyOverrideValue;
};

export type BrowserPeerPolicyOverride = {
  request: BrowserMethodPolicyOverride;
  respond: BrowserMethodPolicyOverride;
};

export type BrowserManualPeerPolicyOverride = {
  pubkey: string;
  policy: BrowserPeerPolicyOverride;
};

export type BrowserPeerScopedPolicyProfile = {
  forPeer: string;
  revision: number;
  updated: number;
  blockAll: boolean;
  request: BrowserMethodPolicy;
  respond: BrowserMethodPolicy;
};

export type BrowserRemotePeerPolicyObservation = {
  pubkey: string;
  profile: BrowserPeerScopedPolicyProfile;
};

export type BrowserGroupPackageMember = {
  idx: number;
  pubkey: string;
};

export type BrowserGroupPackage = {
  groupPk: string;
  threshold: number;
  members: BrowserGroupPackageMember[];
};

export type BrowserSharePackagePayload = {
  shareSecret: string;
  relays: string[];
};

export type BrowserOnboardPackagePayload = BrowserSharePackagePayload & {
  peerPubkey: string;
};

export type BrowserProfilePackagePayload = {
  profileId: string;
  version: number;
  keysetName: string;
  device: {
    name: string;
    shareSecret: string;
    manualPeerPolicyOverrides: BrowserManualPeerPolicyOverride[];
    remotePeerPolicyObservations: BrowserRemotePeerPolicyObservation[];
    relays: string[];
  };
  groupPackage: BrowserGroupPackage;
};

export function shortProfileId(profileId: string) {
  return profileId.trim().slice(0, 8);
}

function sanitizeFilenameSegment(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized;
}

export function buildProfileDownloadFilename(
  label: string,
  profileId: string,
  extension: 'bfprofile.txt' | 'bfshare.txt' | 'bfonboard.txt'
) {
  const shortId = shortProfileId(profileId);
  const stem = sanitizeFilenameSegment(label);
  return `${stem || 'profile'}-${shortId}.${extension}`;
}

export type BrowserEncryptedProfileBackup = {
  version: number;
  keysetName: string;
  device: {
    name: string;
    sharePublicKey: string;
    manualPeerPolicyOverrides: BrowserManualPeerPolicyOverride[];
    remotePeerPolicyObservations: BrowserRemotePeerPolicyObservation[];
    relays: string[];
  };
  groupPackage: BrowserGroupPackage;
};

type RustProfilePackagePair = {
  profile_string: string;
  share_string: string;
};

type RustMethodPolicy = BrowserMethodPolicy;

type RustMethodPolicyOverride = {
  echo: BrowserPolicyOverrideValue;
  ping: BrowserPolicyOverrideValue;
  onboard: BrowserPolicyOverrideValue;
  sign: BrowserPolicyOverrideValue;
  ecdh: BrowserPolicyOverrideValue;
};

type RustPeerPolicyOverride = {
  request: RustMethodPolicyOverride;
  respond: RustMethodPolicyOverride;
};

type RustManualPeerPolicyOverride = {
  pubkey: string;
  policy: RustPeerPolicyOverride;
};

type RustPeerScopedPolicyProfile = {
  for_peer: string;
  revision: number;
  updated: number;
  block_all: boolean;
  request: RustMethodPolicy;
  respond: RustMethodPolicy;
};

type RustRemotePeerPolicyObservation = {
  pubkey: string;
  profile: RustPeerScopedPolicyProfile;
};

type RustGroupMember = {
  idx: number;
  pubkey: string;
};

type RustSharePayload = {
  share_secret: string;
  relays: string[];
};

type RustOnboardPayload = RustSharePayload & {
  peer_pk: string;
};

type RustProfilePayload = {
  profile_id: string;
  version: number;
  keyset_name: string;
  device: {
    name: string;
    share_secret: string;
    manual_peer_policy_overrides: RustManualPeerPolicyOverride[];
    remote_peer_policy_observations: RustRemotePeerPolicyObservation[];
    relays: string[];
  };
  group_package: {
    group_pk: string;
    threshold: number;
    members: RustGroupMember[];
  };
};

type RustEncryptedProfileBackup = {
  version: number;
  keyset_name: string;
  device: {
    name: string;
    share_public_key: string;
    manual_peer_policy_overrides: RustManualPeerPolicyOverride[];
    remote_peer_policy_observations: RustRemotePeerPolicyObservation[];
    relays: string[];
  };
  group_package: RustProfilePayload['group_package'];
};

function hexToBytes(hex: string) {
  const normalized = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('Invalid share secret.');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Invalid ${label}.`);
  }
}

export async function getProfileBackupEventKind() {
  const api = await getWasmProfilePackageApi();
  return api.profile_backup_event_kind();
}

export async function deriveProfileIdFromShareSecret(shareSecret: string) {
  const api = await getWasmProfilePackageApi();
  return api.derive_profile_id_from_share_secret(shareSecret);
}

export async function deriveProfileIdFromSharePublicKey(sharePubkey: string) {
  const api = await getWasmProfilePackageApi();
  return api.derive_profile_id_from_share_pubkey(sharePubkey);
}

function normalizeCompressedPubkey(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^(02|03)[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Invalid ${label}.`);
  }
  return normalized;
}

export function xOnlyFromCompressedPubkey(value: string) {
  return normalizeCompressedPubkey(value, 'compressed pubkey').slice(2);
}

export function groupPublicKeyFromPackage(groupPackage: BrowserGroupPackage) {
  return groupPackage.groupPk.trim().toLowerCase();
}

export function totalCountFromGroupPackage(groupPackage: BrowserGroupPackage) {
  return groupPackage.members.length;
}

export function groupPackageToWireValue(groupPackage: BrowserGroupPackage) {
  return {
    group_pk: groupPackage.groupPk,
    threshold: groupPackage.threshold,
    members: groupPackage.members.map((member) => ({
      idx: member.idx,
      pubkey: member.pubkey,
    })),
  };
}

export function groupPackageToWireJson(groupPackage: BrowserGroupPackage) {
  return JSON.stringify(groupPackageToWireValue(groupPackage), null, 2);
}

function toRustSharePayload(payload: BrowserSharePackagePayload): RustSharePayload {
  return {
    share_secret: payload.shareSecret,
    relays: payload.relays,
  };
}

function fromRustSharePayload(payload: RustSharePayload): BrowserSharePackagePayload {
  return {
    shareSecret: payload.share_secret,
    relays: payload.relays,
  };
}

function toRustOnboardPayload(payload: BrowserOnboardPackagePayload): RustOnboardPayload {
  return {
    share_secret: payload.shareSecret,
    relays: payload.relays,
    peer_pk: payload.peerPubkey,
  };
}

function fromRustOnboardPayload(payload: RustOnboardPayload): BrowserOnboardPackagePayload {
  return {
    shareSecret: payload.share_secret,
    relays: payload.relays,
    peerPubkey: payload.peer_pk,
  };
}

function toRustMethodPolicyOverride(policy: BrowserMethodPolicyOverride): RustMethodPolicyOverride {
  return { ...policy };
}

function fromRustMethodPolicyOverride(policy: RustMethodPolicyOverride): BrowserMethodPolicyOverride {
  return { ...policy };
}

function toRustManualPeerPolicyOverride(
  policy: BrowserManualPeerPolicyOverride,
): RustManualPeerPolicyOverride {
  return {
    pubkey: policy.pubkey,
    policy: {
      request: toRustMethodPolicyOverride(policy.policy.request),
      respond: toRustMethodPolicyOverride(policy.policy.respond),
    },
  };
}

function fromRustManualPeerPolicyOverride(
  policy: RustManualPeerPolicyOverride,
): BrowserManualPeerPolicyOverride {
  return {
    pubkey: policy.pubkey,
    policy: {
      request: fromRustMethodPolicyOverride(policy.policy.request),
      respond: fromRustMethodPolicyOverride(policy.policy.respond),
    },
  };
}

function toRustRemotePeerPolicyObservation(
  policy: BrowserRemotePeerPolicyObservation,
): RustRemotePeerPolicyObservation {
  return {
    pubkey: policy.pubkey,
    profile: {
      for_peer: policy.profile.forPeer,
      revision: policy.profile.revision,
      updated: policy.profile.updated,
      block_all: policy.profile.blockAll,
      request: { ...policy.profile.request },
      respond: { ...policy.profile.respond },
    },
  };
}

function fromRustRemotePeerPolicyObservation(
  policy: RustRemotePeerPolicyObservation,
): BrowserRemotePeerPolicyObservation {
  return {
    pubkey: policy.pubkey,
    profile: {
      forPeer: policy.profile.for_peer,
      revision: policy.profile.revision,
      updated: policy.profile.updated,
      blockAll: policy.profile.block_all,
      request: { ...policy.profile.request },
      respond: { ...policy.profile.respond },
    },
  };
}

function toRustProfilePayload(payload: BrowserProfilePackagePayload): RustProfilePayload {
  return {
    profile_id: payload.profileId,
    version: payload.version,
    keyset_name: payload.keysetName,
    device: {
      name: payload.device.name,
      share_secret: payload.device.shareSecret,
      manual_peer_policy_overrides: payload.device.manualPeerPolicyOverrides.map(toRustManualPeerPolicyOverride),
      remote_peer_policy_observations: payload.device.remotePeerPolicyObservations.map(
        toRustRemotePeerPolicyObservation,
      ),
      relays: payload.device.relays,
    },
    group_package: {
      group_pk: payload.groupPackage.groupPk,
      threshold: payload.groupPackage.threshold,
      members: payload.groupPackage.members.map((member) => ({
        idx: member.idx,
        pubkey: member.pubkey,
      })),
    },
  };
}

function fromRustProfilePayload(payload: RustProfilePayload): BrowserProfilePackagePayload {
  return {
    profileId: payload.profile_id,
    version: payload.version,
    keysetName: payload.keyset_name,
    device: {
      name: payload.device.name,
      shareSecret: payload.device.share_secret,
      manualPeerPolicyOverrides: payload.device.manual_peer_policy_overrides.map(
        fromRustManualPeerPolicyOverride,
      ),
      remotePeerPolicyObservations: payload.device.remote_peer_policy_observations.map(
        fromRustRemotePeerPolicyObservation,
      ),
      relays: payload.device.relays,
    },
    groupPackage: {
      groupPk: payload.group_package.group_pk,
      threshold: payload.group_package.threshold,
      members: payload.group_package.members.map((member) => ({
        idx: member.idx,
        pubkey: member.pubkey,
      })),
    },
  };
}

function fromRustEncryptedProfileBackup(backup: RustEncryptedProfileBackup): BrowserEncryptedProfileBackup {
  return {
    version: backup.version,
    keysetName: backup.keyset_name,
    device: {
      name: backup.device.name,
      sharePublicKey: backup.device.share_public_key,
      manualPeerPolicyOverrides: backup.device.manual_peer_policy_overrides.map(
        fromRustManualPeerPolicyOverride,
      ),
      remotePeerPolicyObservations: backup.device.remote_peer_policy_observations.map(
        fromRustRemotePeerPolicyObservation,
      ),
      relays: backup.device.relays,
    },
    groupPackage: {
      groupPk: backup.group_package.group_pk,
      threshold: backup.group_package.threshold,
      members: backup.group_package.members.map((member) => ({
        idx: member.idx,
        pubkey: member.pubkey,
      })),
    },
  };
}

function toRustEncryptedProfileBackup(backup: BrowserEncryptedProfileBackup): RustEncryptedProfileBackup {
  return {
    version: backup.version,
    keyset_name: backup.keysetName,
    device: {
      name: backup.device.name,
      share_public_key: backup.device.sharePublicKey,
      manual_peer_policy_overrides: backup.device.manualPeerPolicyOverrides.map(
        toRustManualPeerPolicyOverride,
      ),
      remote_peer_policy_observations: backup.device.remotePeerPolicyObservations.map(
        toRustRemotePeerPolicyObservation,
      ),
      relays: backup.device.relays,
    },
    group_package: {
      group_pk: backup.groupPackage.groupPk,
      threshold: backup.groupPackage.threshold,
      members: backup.groupPackage.members.map((member) => ({
        idx: member.idx,
        pubkey: member.pubkey,
      })),
    },
  };
}

export async function createEncryptedProfileBackup(profile: BrowserProfilePackagePayload) {
  const api = await getWasmProfilePackageApi();
  return fromRustEncryptedProfileBackup(
    parseJson<RustEncryptedProfileBackup>(
    api.create_encrypted_profile_backup(JSON.stringify(toRustProfilePayload(profile))),
    'encrypted profile backup',
  ));
}

export async function encodeBfSharePackage(payload: BrowserSharePackagePayload, password: string) {
  const api = await getWasmProfilePackageApi();
  return api.encode_bfshare_package(JSON.stringify(toRustSharePayload(payload)), password);
}

export async function decodeBfSharePackage(packageText: string, password: string) {
  const api = await getWasmProfilePackageApi();
  return fromRustSharePayload(parseJson<RustSharePayload>(
    api.decode_bfshare_package(packageText, password),
    'bfshare payload',
  ));
}

export async function encodeBfOnboardPackage(payload: BrowserOnboardPackagePayload, password: string) {
  const api = await getWasmProfilePackageApi();
  return api.encode_bfonboard_package(JSON.stringify(toRustOnboardPayload(payload)), password);
}

export async function decodeBfOnboardPackage(packageText: string, password: string) {
  const api = await getWasmProfilePackageApi();
  return fromRustOnboardPayload(parseJson<RustOnboardPayload>(
    api.decode_bfonboard_package(packageText, password),
    'bfonboard payload',
  ));
}

export async function encodeBfProfilePackage(payload: BrowserProfilePackagePayload, password: string) {
  const api = await getWasmProfilePackageApi();
  return api.encode_bfprofile_package(JSON.stringify(toRustProfilePayload(payload)), password);
}

export async function decodeBfProfilePackage(packageText: string, password: string) {
  const api = await getWasmProfilePackageApi();
  return fromRustProfilePayload(parseJson<RustProfilePayload>(
    api.decode_bfprofile_package(packageText, password),
    'bfprofile payload',
  ));
}

export async function createProfilePackagePair(payload: BrowserProfilePackagePayload, password: string) {
  const api = await getWasmProfilePackageApi();
  const pair = parseJson<RustProfilePackagePair>(
    api.create_profile_package_pair(JSON.stringify(toRustProfilePayload(payload)), password),
    'profile package pair',
  );
  return {
    profileString: pair.profile_string,
    shareString: pair.share_string,
  };
}

export async function deriveProfileBackupConversationKey(shareSecret: string) {
  const api = await getWasmProfilePackageApi();
  const hex = api.derive_profile_backup_conversation_key_hex(shareSecret);
  return hexToBytes(hex);
}

export async function encryptProfileBackupContent(backup: BrowserEncryptedProfileBackup, shareSecret: string) {
  const api = await getWasmProfilePackageApi();
  return api.encrypt_profile_backup_content(JSON.stringify(toRustEncryptedProfileBackup(backup)), shareSecret);
}

export async function decryptProfileBackupContent(ciphertext: string, shareSecret: string) {
  const api = await getWasmProfilePackageApi();
  return fromRustEncryptedProfileBackup(parseJson<RustEncryptedProfileBackup>(
    api.decrypt_profile_backup_content(ciphertext, shareSecret),
    'encrypted profile backup',
  ));
}

export async function buildProfileBackupEvent(
  shareSecret: string,
  backup: BrowserEncryptedProfileBackup,
  createdAt?: number | null,
) {
  const api = await getWasmProfilePackageApi();
  return parseJson<Event>(
    api.build_profile_backup_event(
      shareSecret,
      JSON.stringify(toRustEncryptedProfileBackup(backup)),
      createdAt ?? null,
    ),
    'profile backup event',
  );
}

export async function parseProfileBackupEvent(event: Event, shareSecret: string) {
  const api = await getWasmProfilePackageApi();
  return fromRustEncryptedProfileBackup(
    parseJson<RustEncryptedProfileBackup>(
      api.parse_profile_backup_event(JSON.stringify(event), shareSecret),
      'encrypted profile backup',
    ),
  );
}
