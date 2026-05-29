// Onboarding transport helpers.
//
// PR30: extracted verbatim from `browser-runtime-core.ts`. Covers the
// onboarding request/response wire decoding, bfonboard descriptor
// validation, and the per-request decrypt rate-limit counter. The relay
// round-trip that drives an onboarding request lives on `BrowserBridgeNode`
// (`wasm-bridge-node.ts`); the pure decode/validation helpers live here.

import { type Event } from 'nostr-tools';

import { isRecord } from './runtime-internal';
import type {
  BridgeEnvelope,
  OnboardingRequestBundleWire,
  PolicyOverrideValue
} from './wire';

/**
 * Maximum number of decrypt attempts allowed per onboarding request window.
 *
 * An adversarial relay could otherwise flood the onevent handler with
 * malformed envelopes. Rejecting after a fixed budget bounds worst-case
 * CPU use and makes the abuse observable via `decrypt_cap_reached`. The
 * counter is scoped to the requestId; a fresh onboarding request starts
 * fresh. The 30s window matches the onboarding timeout; once the outer
 * subscription closes, further events are ignored regardless.
 */
export const MAX_ONBOARDING_DECRYPTS = 50;

export type PeerPolicyOverridePatch = {
  direction: 'request' | 'respond';
  method: 'ping' | 'onboard' | 'sign' | 'ecdh';
  value: PolicyOverrideValue;
};

/**
 * Per-request decrypt budget tracker for the onboarding subscription.
 *
 * Scoped to a single onboarding request (by `requestId`) rather than
 * globally so a legitimate operator retry is not penalized by a prior
 * adversarial burst. Once the counter hits the cap, further decrypt
 * attempts are refused; the first refusal trips the `capWarned` flag so
 * a single `decrypt_cap_reached` observability event is emitted per
 * request window rather than once per dropped event.
 *
 * @internal
 */
export type OnboardingDecryptCounter = {
  attempts: number;
  capWarned: boolean;
};

/** @internal */
export function createOnboardingDecryptCounter(): OnboardingDecryptCounter {
  return { attempts: 0, capWarned: false };
}

/**
 * Advance the decrypt budget. Returns `'cap_reached_first'` exactly once
 * per onboarding window (when the cap is first crossed), `'cap_reached'`
 * for subsequent refusals, and `'allow'` while budget remains. Callers
 * emit the `decrypt_cap_reached` event only on the `'cap_reached_first'`
 * outcome.
 *
 * @internal
 */
export function recordOnboardingDecryptAttempt(
  counter: OnboardingDecryptCounter,
  maxAttempts: number = MAX_ONBOARDING_DECRYPTS,
): 'allow' | 'cap_reached_first' | 'cap_reached' {
  if (counter.attempts >= maxAttempts) {
    if (!counter.capWarned) {
      counter.capWarned = true;
      return 'cap_reached_first';
    }
    return 'cap_reached';
  }
  counter.attempts += 1;
  return 'allow';
}

/**
 * Outcome of validating a decrypted onboarding group descriptor.
 *
 * The TS/Rust split in the onboarding pathway is:
 *   - TS (this function) owns input validation: structural shape, member
 *     uniqueness, threshold bounds, presence of the local share pubkey in
 *     the member set. These checks cannot depend on secret material.
 *   - bifrost-rs (`build_onboarding_runtime_snapshot`) owns cryptographic
 *     validation: signatures, threshold-signature correctness, share
 *     validity.
 * Both sides must pass. A failing TS-side check drops the event and
 * surfaces a scalar observability signal; the payload never reaches WASM.
 *
 * @internal
 */
export type OnboardingGroupValidation =
  | { kind: 'ok'; memberCount: number; threshold: number }
  | { kind: 'malformed' }
  | { kind: 'peer_not_in_group' }
  | { kind: 'duplicate_members' }
  | { kind: 'bad_threshold' };

/**
 * Validate the `group` subobject of a decrypted OnboardResponse envelope
 * before handing it to the runtime. See `OnboardingGroupValidation` for
 * the per-outcome semantics.
 *
 * `sharePubkey32` is the caller's share x-only pubkey in lowercase hex.
 * Member pubkeys may be 32-byte (x-only, 64 hex chars) or 33-byte
 * (compressed, 66 hex chars with `02`/`03` prefix); both encodings are
 * accepted and the membership test matches on the trailing 32-byte
 * component.
 *
 * @internal
 */
export function validateOnboardingGroup(
  group: unknown,
  sharePubkey32: string,
): OnboardingGroupValidation {
  if (!isRecord(group)) return { kind: 'malformed' };
  const members = group.members;
  if (!Array.isArray(members) || members.length < 1) {
    return { kind: 'malformed' };
  }

  const memberPubkeys: string[] = [];
  for (const entry of members) {
    if (!isRecord(entry) || typeof entry.pubkey !== 'string') {
      return { kind: 'malformed' };
    }
    memberPubkeys.push(entry.pubkey.toLowerCase());
  }

  const sharePubkeyLower = sharePubkey32.toLowerCase();
  if (!memberPubkeys.some((pk) => pk.endsWith(sharePubkeyLower))) {
    return { kind: 'peer_not_in_group' };
  }

  const uniqueMembers = new Set(memberPubkeys);
  if (uniqueMembers.size !== memberPubkeys.length) {
    return { kind: 'duplicate_members' };
  }

  const threshold = group.threshold;
  if (
    typeof threshold !== 'number' ||
    !Number.isFinite(threshold) ||
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    threshold > memberPubkeys.length
  ) {
    return { kind: 'bad_threshold' };
  }

  return {
    kind: 'ok',
    memberCount: memberPubkeys.length,
    threshold,
  };
}

export function parseBridgeEnvelope(value: string): BridgeEnvelope | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return null;
    if (typeof parsed.request_id !== 'string') return null;
    if (!isRecord(parsed.payload)) return null;
    if (typeof parsed.payload.type !== 'string') return null;
    return {
      request_id: parsed.request_id,
      sent_at: Number(parsed.sent_at ?? 0),
      payload: {
        type: parsed.payload.type,
        data: parsed.payload.data
      }
    };
  } catch {
    return null;
  }
}

export function parseOnboardingRequestBundle(value: string): OnboardingRequestBundleWire {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Invalid onboarding request bundle');
  }
  if (typeof parsed.request_id !== 'string' || !parsed.request_id.trim()) {
    throw new Error('Invalid onboarding request id');
  }
  if (typeof parsed.local_pubkey32 !== 'string' || !parsed.local_pubkey32.trim()) {
    throw new Error('Invalid onboarding local pubkey');
  }
  if (!Array.isArray(parsed.request_nonces)) {
    throw new Error('Invalid onboarding request nonces');
  }
  if (typeof parsed.bootstrap_state_hex !== 'string' || !parsed.bootstrap_state_hex.trim()) {
    throw new Error('Invalid onboarding bootstrap state');
  }
  if (typeof parsed.event_json !== 'string' || !parsed.event_json.trim()) {
    throw new Error('Invalid onboarding request event');
  }
  return parsed as OnboardingRequestBundleWire;
}

export function parseEventJson(value: string, context: string): Event {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Invalid ${context}`);
  }
  return parsed as Event;
}
