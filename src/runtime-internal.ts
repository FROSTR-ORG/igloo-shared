// Shared internal helpers for the browser runtime modules.
//
// Extracted verbatim from `browser-runtime-core.ts` in PR30 so that the
// topical modules (`relay-transport`, `onboarding-transport`, `runtime-pump`,
// `wasm-bridge-node`, `runtime-api`) can share the same low-level utilities
// without duplicating them. Nothing here is part of the public package
// surface; these are in-repo helpers only.

import { validateEvent } from 'nostr-tools/pure';
import { getPublicKey } from 'nostr-tools';

import { createLogger } from './observability';
import { SecretBytes } from './secret';

const DEFAULT_RELAYS_FALLBACK = ['ws://127.0.0.1:8194'];
const BROWSER_RUNTIME_ENV = ((import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env ?? {});

function envDefaultRelays(): string[] {
  const raw = BROWSER_RUNTIME_ENV.VITE_DEFAULT_RELAYS;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return DEFAULT_RELAYS_FALLBACK;
  }
  const parsed = raw
    .split(/[,\s]+/)
    .map((relay) => relay.trim())
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_RELAYS_FALLBACK;
}

export const DEFAULT_RELAYS = envDefaultRelays();

const BIFROST_EVENT_KIND_RAW = Number(BROWSER_RUNTIME_ENV.VITE_BIFROST_EVENT_KIND ?? 20000);
export const BIFROST_EVENT_KIND = Number.isFinite(BIFROST_EVENT_KIND_RAW)
  ? BIFROST_EVENT_KIND_RAW
  : 20000;
export const ONBOARD_TIMEOUT_MS = 10_000;
export const PING_TIMEOUT_MS = 10_000;
export const BRIDGE_COMMAND_TIMEOUT_MS = 10_000;
export const PREPARE_OPERATION_TIMEOUT_MS = 10_000;
export const WASM_RUNTIME_INIT_TIMEOUT_MS = 10_000;
export const RELAY_CONNECT_TIMEOUT_MS = 10_000;
// Cadence for the background relay-health re-probe (keeps `connected_relays`
// current so the dashboard can detect drops/recoveries after bootstrap).
export const RELAY_HEALTH_INTERVAL_MS = 30_000;
export const RECOVERED_PENDING_OPS_REASON = 'pending_operations_recovered';
export const INSUFFICIENT_SIGNING_PEERS_REASON = 'insufficient_signing_peers';
export const INSUFFICIENT_ECDH_PEERS_REASON = 'insufficient_ecdh_peers';

export const logger = createLogger('igloo.runtime');

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}

export function canProceedWhileDegraded(kind: 'sign' | 'ecdh', degradedReasons: string[]) {
  if (degradedReasons.length === 0) {
    return false;
  }

  const allowedReasons =
    kind === 'sign'
      ? new Set([RECOVERED_PENDING_OPS_REASON, INSUFFICIENT_ECDH_PEERS_REASON])
      : new Set([RECOVERED_PENDING_OPS_REASON, INSUFFICIENT_SIGNING_PEERS_REASON]);

  return degradedReasons.every((reason) => allowedReasons.has(reason));
}

export function nowUnixSecs(): number {
  return Math.floor(Date.now() / 1000);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function toErrorMessage(value: unknown, fallback = 'Request failed'): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (value instanceof Error && value.message) return value.message;
  if (isRecord(value)) {
    const message = value.message;
    if (typeof message === 'string' && message.trim()) return message;
    const error = value.error;
    if (typeof error === 'string' && error.trim()) return error;
    const reason = value.reason;
    if (typeof reason === 'string' && reason.trim()) return reason;
  }
  return fallback;
}

export function withContext(step: string, error: unknown): Error {
  return new Error(`${step}: ${toErrorMessage(error, 'unknown error')}`);
}

export function normalizePubkey32Hex(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(normalized)) {
    return normalized;
  }
  if (/^(02|03)[0-9a-f]{64}$/.test(normalized)) {
    return normalized.slice(2);
  }
  throw new Error(`Invalid ${label}`);
}

export function normalizeHex32(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

export function hexToBytes(value: string): Uint8Array {
  const hex = value.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error('Invalid hex payload');
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function allPolicyFlagsEnabled(value: unknown): boolean {
  if (!isRecord(value)) return true;
  const flags = ['echo', 'ping', 'onboard', 'sign', 'ecdh'];
  return flags.every((key) => value[key] !== false);
}

// Standard NIP-44 v2 conversation-key derivation: HMAC(key='nip44-v2', ikm) is
// exactly HKDF-Extract, and the IKM is the raw X-coordinate of the ECDH shared
// point — bifrost-core `combine_ecdh_packages` now returns that raw-X (it used to
// return SHA256(point), which broke interop). So the app-facing
// `window.nostr.nip44.{encrypt,decrypt}` conversation key matches what any
// standard nostr client derives. Verified by src/nip44-interop.test.ts.
export async function deriveConversationKeyFromSharedSecret(sharedSecretHex32: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('nip44-v2'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sharedSecretBytes = new Uint8Array(hexToBytes(sharedSecretHex32));
  const digest = await crypto.subtle.sign('HMAC', key, sharedSecretBytes);
  return new Uint8Array(digest);
}

export function buildUnsignedEvent(event: Record<string, unknown>, pubkey: string) {
  const candidate = {
    kind: event.kind,
    tags: event.tags ?? [],
    content: event.content ?? '',
    created_at:
      typeof event.created_at === 'number' ? event.created_at : Math.floor(Date.now() / 1000),
    pubkey
  };

  if (!validateEvent(candidate)) {
    throw new Error('Event failed validation');
  }

  return candidate;
}

/**
 * Derive the normalized share public key from a share seckey hex, wiping the
 * transient secret bytes immediately after the pubkey is computed.
 *
 * The seckey arrives as a bare string on the snapshot wire by policy (see
 * `wire/runtime.ts` — a serialized wire cannot carry a runtime `Secret`
 * wrapper, and the observability schema already forbids logging it). A JS
 * string cannot be zeroized, but the `Uint8Array` form can: this keeps the
 * byte copy from lingering until GC.
 */
export function sharePubkeyFromSeckeyHex(seckeyHex: string): string {
  const bytes = SecretBytes.fromHex(seckeyHex);
  try {
    return normalizePubkey32Hex(getPublicKey(bytes.expose()), 'share public key');
  } finally {
    bytes.wipe();
  }
}
