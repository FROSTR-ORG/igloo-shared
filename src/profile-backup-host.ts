import { SimplePool, getPublicKey, type Event, type Filter } from 'nostr-tools';

import {
  type BrowserEncryptedProfileBackup,
  type BrowserProfilePackagePayload,
  type BrowserSharePackagePayload,
  buildProfileBackupEvent,
  decodeBfSharePackage,
  deriveProfileIdFromShareSecret,
  getProfileBackupEventKind,
  parseProfileBackupEvent,
} from './profile-package';

export type BrowserShareRecoveryResult = {
  share: BrowserSharePackagePayload;
  backup: BrowserEncryptedProfileBackup;
  profile: BrowserProfilePackagePayload;
  event: Event;
};

const HEX_32_REGEX = /^[0-9a-f]{64}$/;

function normalizeHex32(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!HEX_32_REGEX.test(normalized)) {
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
  const normalized = normalizeHex32(hex, 'share secret');
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function publicKeyFromSecret(shareSecret: string) {
  return getPublicKey(hexToBytes(shareSecret)).toLowerCase();
}

function closePool(pool: SimplePool, relays: string[]) {
  try {
    pool.close(relays);
  } catch {
    // ignore
  }
  try {
    pool.destroy();
  } catch {
    // ignore
  }
}

export async function publishEncryptedProfileBackup(input: {
  relays: string[];
  shareSecret: string;
  backup: BrowserEncryptedProfileBackup;
  createdAt?: number;
  maxWait?: number;
}) {
  const relays = normalizeRelays(input.relays);
  const shareSecret = normalizeHex32(input.shareSecret, 'share secret');
  const event = await buildProfileBackupEvent(
    shareSecret,
    input.backup,
    input.createdAt ?? null,
  );
  const pool = new SimplePool();
  try {
    const results = await Promise.allSettled(
      pool.publish(relays, event, { maxWait: input.maxWait ?? 1_500 }),
    );
    if (!results.some((result) => result.status === 'fulfilled')) {
      throw new Error('Failed to publish encrypted profile backup.');
    }
    return event;
  } finally {
    closePool(pool, relays);
  }
}

export async function fetchLatestEncryptedProfileBackup(input: {
  relays: string[];
  shareSecret: string;
  maxWait?: number;
}) {
  const relays = normalizeRelays(input.relays);
  const shareSecret = normalizeHex32(input.shareSecret, 'share secret');
  const author = publicKeyFromSecret(shareSecret);
  const backupEventKind = await getProfileBackupEventKind();
  const pool = new SimplePool();
  try {
    const event = await pool.get(
      relays,
      {
        kinds: [backupEventKind],
        authors: [author],
      } as Filter,
      { maxWait: input.maxWait ?? 2_000 },
    );
    if (!event) {
      throw new Error('No encrypted profile backup was found for this share.');
    }
    const backup = await parseProfileBackupEvent(event, shareSecret);
    if (backup.device.sharePublicKey !== author) {
      throw new Error('Encrypted profile backup does not match the provided share.');
    }
    return { event, backup };
  } finally {
    closePool(pool, relays);
  }
}

export async function recoverProfileFromSharePackage(
  packageText: string,
  password: string,
  options?: { maxWait?: number },
) {
  const share = await decodeBfSharePackage(packageText, password);
  const { event, backup } = await fetchLatestEncryptedProfileBackup({
    relays: share.relays,
    shareSecret: share.shareSecret,
    maxWait: options?.maxWait,
  });
  const profile: BrowserProfilePackagePayload = {
    profileId: await deriveProfileIdFromShareSecret(share.shareSecret),
    version: backup.version,
    device: {
      name: backup.device.name,
      shareSecret: share.shareSecret,
      manualPeerPolicyOverrides: backup.device.manualPeerPolicyOverrides,
      relays: backup.device.relays,
    },
    groupPackage: backup.groupPackage,
  };
  return {
    share,
    backup,
    profile,
    event,
  } satisfies BrowserShareRecoveryResult;
}
