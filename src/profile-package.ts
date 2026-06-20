import { getWasmProfilePackageApi } from './bridge-wasm-runtime';
import type { Passphrase } from './secret';

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

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function readInteger(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/**
 * Parse a stored group-package wire JSON (the snake_case shape produced by
 * {@link groupPackageToWireJson}, persisted on profiles as `group_package_json`)
 * back into a {@link BrowserGroupPackage}. Accepts the camelCase in-memory
 * shape too so older local profile records remain recoverable.
 */
export function groupPackageFromWireJson(value: string): BrowserGroupPackage {
  const parsed = parseJson<{
    group_name?: unknown;
    groupName?: unknown;
    group_pk?: unknown;
    groupPk?: unknown;
    threshold?: unknown;
    members?: unknown;
  }>(value, 'group package');

  const groupName = readString(parsed.group_name) || readString(parsed.groupName);
  const groupPk = (readString(parsed.group_pk) || readString(parsed.groupPk)).toLowerCase();
  const threshold = readInteger(parsed.threshold);
  if (!groupName || !groupPk || threshold <= 0 || !Array.isArray(parsed.members)) {
    throw new Error('Invalid group package.');
  }

  const members = parsed.members.map((entry): BrowserGroupPackageMember => {
    const member = entry && typeof entry === 'object' ? (entry as { idx?: unknown; pubkey?: unknown }) : {};
    const idx = readInteger(member.idx);
    const pubkey = readString(member.pubkey).toLowerCase();
    if (idx < 0 || !pubkey) {
      throw new Error('Invalid group package member.');
    }
    return { idx, pubkey };
  });

  return {
    groupName,
    groupPk,
    threshold,
    members,
  };
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

// The package password is a `Passphrase` (redacted on log, greppable `.expose()`),
// unwrapped only here at the WASM boundary.
export async function encodeBfSharePackage(payload: BrowserSharePackagePayload, password: Passphrase) {
  const api = await getWasmProfilePackageApi();
  return api.encode_bfshare_package(JSON.stringify(payload), password.expose());
}

export async function decodeBfSharePackage(packageText: string, password: Passphrase) {
  const api = await getWasmProfilePackageApi();
  return parseJson<BrowserSharePackagePayload>(
    api.decode_bfshare_package(packageText, password.expose()),
    'bfshare payload',
  );
}

export async function encodeBfOnboardPackage(payload: BrowserOnboardPackagePayload, password: Passphrase) {
  const api = await getWasmProfilePackageApi();
  return api.encode_bfonboard_package(JSON.stringify(payload), password.expose());
}

export async function decodeBfOnboardPackage(packageText: string, password: Passphrase) {
  const api = await getWasmProfilePackageApi();
  return parseJson<BrowserOnboardPackagePayload>(
    api.decode_bfonboard_package(packageText, password.expose()),
    'bfonboard payload',
  );
}

export async function encodeBfProfilePackage(payload: BrowserProfilePackagePayload, password: Passphrase) {
  const api = await getWasmProfilePackageApi();
  return api.encode_bfprofile_package(JSON.stringify(payload), password.expose());
}

export async function decodeBfProfilePackage(packageText: string, password: Passphrase) {
  const api = await getWasmProfilePackageApi();
  return parseJson<BrowserProfilePackagePayload>(
    api.decode_bfprofile_package(packageText, password.expose()),
    'bfprofile payload',
  );
}

export async function createProfilePackagePair(payload: BrowserProfilePackagePayload, password: Passphrase) {
  const api = await getWasmProfilePackageApi();
  return parseJson<BrowserProfilePackagePair>(
    api.create_profile_package_pair(JSON.stringify(payload), password.expose()),
    'profile package pair',
  );
}
