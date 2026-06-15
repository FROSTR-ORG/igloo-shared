// Shared internal helpers for the browser runtime modules.
//
// Extracted verbatim from `browser-runtime-core.ts` in PR30 so that the
// topical modules (`relay-transport`, `onboarding-transport`, `runtime-pump`,
// `wasm-bridge-node`, `runtime-api`) can share the same low-level utilities
// without duplicating them. Nothing here is part of the public package
// surface; these are in-repo helpers only.

import { validateEvent } from 'nostr-tools/pure';

import { createLogger } from './observability';

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

// WARNING: NON-STANDARD NIP-44 conversation key. The IKM here is the FROSTR
// threshold-ECDH shared secret, which is `SHA256(combined point)` (see
// bifrost-core `combine_ecdh_packages`) — NOT the raw X-coordinate that standard
// NIP-44 feeds to HKDF-Extract. So messages produced via this path (including the
// app-facing `window.nostr.nip44.{encrypt,decrypt}` provider methods) are
// FROSTR-internal and do NOT interoperate with standard NIP-44 peers. The
// onboarding path uses the standard `getConversationKey` (raw-X) instead.
// This divergence is a known interop bug — see BACKLOG: "Unify app-facing NIP-44
// on the standard raw-X derivation".
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
