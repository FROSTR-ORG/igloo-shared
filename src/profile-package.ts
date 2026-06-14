import { getWasmProfilePackageApi } from './bridge-wasm-runtime';

export type BrowserProtectedPackageKind = 'bfprofile' | 'bfshare' | 'bfonboard';

export type BrowserPolicyOverrideValue = 'unset' | 'allow' | 'deny' | 'ask';

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

type BrowserProfilePackagePair = {
  profileString: string;
  shareString: string;
};

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Invalid ${label}.`);
  }
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

/**
 * Parse a stored group-package wire JSON (the snake_case shape produced by
 * {@link groupPackageToWireJson}, persisted on profiles as `group_package_json`)
 * back into a {@link BrowserGroupPackage}. Used by recovery/rotation to recover
 * the group context locally instead of fetching it from a relay.
 */
export function groupPackageFromWireJson(json: string): BrowserGroupPackage {
  const wire = parseJson<{
    group_name?: unknown;
    group_pk?: unknown;
    threshold?: unknown;
    members?: unknown;
  }>(json, 'group package');
  if (
    typeof wire.group_name !== 'string' ||
    typeof wire.group_pk !== 'string' ||
    typeof wire.threshold !== 'number' ||
    !Array.isArray(wire.members)
  ) {
    throw new Error('Invalid group package.');
  }
  return {
    groupName: wire.group_name,
    groupPk: wire.group_pk,
    threshold: wire.threshold,
    members: wire.members.map((member) => {
      const entry = member as { idx?: unknown; pubkey?: unknown };
      if (typeof entry.idx !== 'number' || typeof entry.pubkey !== 'string') {
        throw new Error('Invalid group package member.');
      }
      return { idx: entry.idx, pubkey: entry.pubkey };
    }),
  };
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
