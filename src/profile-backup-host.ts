import { SimplePool, type Event, type Filter } from 'nostr-tools';

import {
  type BrowserEncryptedProfileBackup,
  type BrowserProfilePackagePayload,
  type BrowserSharePackagePayload,
  buildProfileBackupEvent,
  decodeBfSharePackage,
  getProfileBackupEventKind,
  parseProfileBackupEvent,
  recoverProfileFromShareAndBackup,
} from './profile-package';
import { normalizeHex32, publicKeyFromSecret } from './browser-profile/core';

export type BrowserShareRecoveryResult = {
  share: BrowserSharePackagePayload;
  backup: BrowserEncryptedProfileBackup;
  profile: BrowserProfilePackagePayload;
  event: Event;
};

function normalizeRelays(relays: string[]) {
  const normalized = relays.map((relay) => relay.trim()).filter(Boolean);
  if (!normalized.length) {
    throw new Error('At least one relay is required.');
  }
  return normalized;
}

let testPublishTransport: ((event: Event, relays: string[]) => void | Promise<void>) | null = null;

/**
 * Test-only seam. When set, {@link publishEncryptedProfileBackup} skips the real
 * `SimplePool` relay publish (no network) and hands the built event to this hook
 * instead. Browser unit tests use it so the create/import save flows don't open
 * real relay WebSockets (which in jsdom resolve after teardown and surface a
 * spurious undici unhandled error). Do not call from production code.
 */
export function __setProfileBackupPublishForTests(
  fn: ((event: Event, relays: string[]) => void | Promise<void>) | null,
) {
  testPublishTransport = fn;
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
  if (testPublishTransport) {
    await testPublishTransport(event, relays);
    return event;
  }
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
  const profile: BrowserProfilePackagePayload = await recoverProfileFromShareAndBackup(
    share,
    backup,
  );
  return {
    share,
    backup,
    profile,
    event,
  } satisfies BrowserShareRecoveryResult;
}
