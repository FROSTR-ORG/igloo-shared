/**
 * Pure onboarding wire-shape type declarations.
 *
 * Decoded onboarding payloads and the request/response envelopes exchanged
 * during the device->host onboarding handshake. Pure types only — no
 * runtime/value code.
 *
 * Extracted from `browser-runtime-core.ts` (PR29, Bucket G.1). No behavior
 * changed; only the declarations moved.
 */

import type { ShareSecretHex } from '../secret';
import type { GroupPackageWire } from './runtime';

export type OnboardingDecoded = {
  // The decoded share secret is the crown-jewel onboarding secret; hold it wrapped
  // (redacted on accidental log, greppable `.expose()`) as it flows to the WASM calls.
  share_secret: ShareSecretHex;
  share_pubkey32: string;
  peer_pk_xonly: string;
  relays: string[];
};

export type OnboardingRequestBundleWire = {
  request_id: string;
  local_pubkey32: string;
  request_nonces: unknown[];
  bootstrap_state_hex: string;
  event_json: string;
};

export type OnboardResponseWire = {
  group: GroupPackageWire;
  nonces: unknown[];
};

export type OnboardingRequestResult = {
  response: OnboardResponseWire;
  bundle: OnboardingRequestBundleWire;
};
