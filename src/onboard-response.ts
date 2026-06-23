import type { Filter } from 'nostr-tools';

import { isRecord } from './runtime-internal';
import { validateOnboardingGroup, type OnboardingGroupValidation } from './onboarding-transport';
import type { BridgeEnvelope, OnboardResponseWire } from './wire';

export type OnboardResponseFilterInput = {
  eventKind: number;
  peerPubkey32: string;
  localPubkey32: string;
  since: number;
};

export function buildOnboardResponseFilter({
  eventKind,
  peerPubkey32,
  localPubkey32,
  since,
}: OnboardResponseFilterInput): Filter {
  return {
    kinds: [eventKind],
    authors: [peerPubkey32],
    '#p': [localPubkey32.toLowerCase()],
    since,
  };
}

export type OnboardResponseResolveResult =
  | { kind: 'ok'; response: OnboardResponseWire }
  | {
      kind: 'ignore';
      reason:
        | 'request_mismatch'
        | 'wrong_payload_type'
        | Exclude<OnboardingGroupValidation['kind'], 'ok'>;
    };

export function resolveOnboardResponseEnvelope(
  envelope: BridgeEnvelope,
  requestId: string,
  localPubkey32: string,
): OnboardResponseResolveResult {
  if (envelope.request_id !== requestId) {
    return { kind: 'ignore', reason: 'request_mismatch' };
  }
  if (envelope.payload.type !== 'OnboardResponse') {
    return { kind: 'ignore', reason: 'wrong_payload_type' };
  }
  if (!isRecord(envelope.payload.data)) {
    return { kind: 'ignore', reason: 'malformed' };
  }
  if (!isRecord(envelope.payload.data.group)) {
    return { kind: 'ignore', reason: 'malformed' };
  }

  // Defense-in-depth: validate the decrypted group descriptor before handing it
  // to the runtime. See `validateOnboardingGroup` for the TS/Rust split.
  const validation = validateOnboardingGroup(envelope.payload.data.group, localPubkey32);
  if (validation.kind !== 'ok') {
    return { kind: 'ignore', reason: validation.kind };
  }

  return {
    kind: 'ok',
    response: envelope.payload.data as OnboardResponseWire,
  };
}
