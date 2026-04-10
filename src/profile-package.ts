import type { Event } from 'nostr-tools';

import { getWasmProfilePackageApi } from './bridge-wasm-runtime';

export type BrowserProtectedPackageKind = 'bfprofile' | 'bfshare' | 'bfonboard';

export type BrowserPolicyOverrideValue = 'unset' | 'allow' | 'deny';

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

export type BrowserGroupPackageMember = {
  idx: number;
  pubkey: string;
};

export type BrowserGroupPackage = {
  groupName: string;
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
  device: {
    name: string;
    shareSecret: string;
    manualPeerPolicyOverrides: BrowserManualPeerPolicyOverride[];
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
  device: {
    name: string;
    sharePublicKey: string;
    manualPeerPolicyOverrides: BrowserManualPeerPolicyOverride[];
    relays: string[];
  };
  groupPackage: BrowserGroupPackage;
};

type BrowserProfilePackagePair = {
  profileString: string;
  shareString: string;
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

export function groupNameFromPackage(groupPackage: BrowserGroupPackage) {
  return groupPackage.groupName.trim();
}

export function totalCountFromGroupPackage(groupPackage: BrowserGroupPackage) {
  return groupPackage.members.length;
}

export function groupPackageToWireValue(groupPackage: BrowserGroupPackage) {
  return {
    group_name: groupPackage.groupName,
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

export function sharePackageToWireValue(memberIdx: number, shareSecret: string) {
  return {
    idx: memberIdx,
    seckey: shareSecret,
  };
}

export function sharePackageToWireJson(memberIdx: number, shareSecret: string) {
  return JSON.stringify(sharePackageToWireValue(memberIdx, shareSecret), null, 2);
}

export async function createEncryptedProfileBackup(profile: BrowserProfilePackagePayload) {
  const api = await getWasmProfilePackageApi();
  return parseJson<BrowserEncryptedProfileBackup>(
    api.create_encrypted_profile_backup(JSON.stringify(profile)),
    'encrypted profile backup',
  );
}

export async function encodeBfSharePackage(payload: BrowserSharePackagePayload, password: string) {
  const api = await getWasmProfilePackageApi();
  return api.encode_bfshare_package(JSON.stringify(payload), password);
}

export async function decodeBfSharePackage(packageText: string, password: string) {
  const api = await getWasmProfilePackageApi();
  return parseJson<BrowserSharePackagePayload>(
    api.decode_bfshare_package(packageText, password),
    'bfshare payload',
  );
}

export async function encodeBfOnboardPackage(payload: BrowserOnboardPackagePayload, password: string) {
  const api = await getWasmProfilePackageApi();
  return api.encode_bfonboard_package(JSON.stringify(payload), password);
}

export async function decodeBfOnboardPackage(packageText: string, password: string) {
  const api = await getWasmProfilePackageApi();
  return parseJson<BrowserOnboardPackagePayload>(
    api.decode_bfonboard_package(packageText, password),
    'bfonboard payload',
  );
}

export async function encodeBfProfilePackage(payload: BrowserProfilePackagePayload, password: string) {
  const api = await getWasmProfilePackageApi();
  return api.encode_bfprofile_package(JSON.stringify(payload), password);
}

export async function decodeBfProfilePackage(packageText: string, password: string) {
  const api = await getWasmProfilePackageApi();
  return parseJson<BrowserProfilePackagePayload>(
    api.decode_bfprofile_package(packageText, password),
    'bfprofile payload',
  );
}

export async function createProfilePackagePair(payload: BrowserProfilePackagePayload, password: string) {
  const api = await getWasmProfilePackageApi();
  return parseJson<BrowserProfilePackagePair>(
    api.create_profile_package_pair(JSON.stringify(payload), password),
    'profile package pair',
  );
}

export async function deriveProfileBackupConversationKey(shareSecret: string) {
  const api = await getWasmProfilePackageApi();
  const hex = api.derive_profile_backup_conversation_key_hex(shareSecret);
  return hexToBytes(hex);
}

export async function encryptProfileBackupContent(backup: BrowserEncryptedProfileBackup, shareSecret: string) {
  const api = await getWasmProfilePackageApi();
  return api.encrypt_profile_backup_content(JSON.stringify(backup), shareSecret);
}

export async function decryptProfileBackupContent(ciphertext: string, shareSecret: string) {
  const api = await getWasmProfilePackageApi();
  return parseJson<BrowserEncryptedProfileBackup>(
    api.decrypt_profile_backup_content(ciphertext, shareSecret),
    'encrypted profile backup',
  );
}

export async function buildProfileBackupEvent(
  shareSecret: string,
  backup: BrowserEncryptedProfileBackup,
  createdAt?: number | null,
) {
  const api = await getWasmProfilePackageApi();
  return parseJson<Event>(
    api.build_profile_backup_event(shareSecret, JSON.stringify(backup), createdAt ?? null),
    'profile backup event',
  );
}

export async function parseProfileBackupEvent(event: Event, shareSecret: string) {
  const api = await getWasmProfilePackageApi();
  return parseJson<BrowserEncryptedProfileBackup>(
    api.parse_profile_backup_event(JSON.stringify(event), shareSecret),
    'encrypted profile backup',
  );
}

export async function recoverProfileFromShareAndBackup(
  share: BrowserSharePackagePayload,
  backup: BrowserEncryptedProfileBackup,
) {
  const api = await getWasmProfilePackageApi();
  return parseJson<BrowserProfilePackagePayload>(
    api.recover_profile_from_share_and_backup(JSON.stringify(share), JSON.stringify(backup)),
    'recovered profile payload',
  );
}
