import { describe, expect, test } from 'vitest';

import {
  buildOnboardResponseFilter,
  resolveOnboardResponseEnvelope,
} from './onboard-response';
import type { BridgeEnvelope } from './wire';

const requestId = 'request-1';
const localPubkey = 'aa'.repeat(32);
const peerPubkey = 'bb'.repeat(32);
const group = {
  group_pk: 'cc'.repeat(32),
  threshold: 1,
  members: [{ idx: 1, pubkey: localPubkey }],
};

function envelope(overrides: Partial<BridgeEnvelope> = {}): BridgeEnvelope {
  return {
    request_id: requestId,
    sent_at: 1,
    payload: {
      type: 'OnboardResponse',
      data: {
        group,
        nonces: ['n1'],
      },
    },
    ...overrides,
  };
}

describe('buildOnboardResponseFilter', () => {
  test('builds the relay filter used to await the host response', () => {
    expect(
      buildOnboardResponseFilter({
        eventKind: 20000,
        peerPubkey32: peerPubkey.toUpperCase(),
        localPubkey32: localPubkey.toUpperCase(),
        since: 123,
      }),
    ).toEqual({
      kinds: [20000],
      authors: [peerPubkey.toUpperCase()],
      '#p': [localPubkey],
      since: 123,
    });
  });
});

describe('resolveOnboardResponseEnvelope', () => {
  test('accepts a matching valid response envelope', () => {
    expect(resolveOnboardResponseEnvelope(envelope(), requestId, localPubkey)).toEqual({
      kind: 'ok',
      response: {
        group,
        nonces: ['n1'],
      },
    });
  });

  test('drops mismatched or malformed envelopes with explicit reasons', () => {
    expect(resolveOnboardResponseEnvelope(envelope({ request_id: 'other' }), requestId, localPubkey)).toEqual({
      kind: 'ignore',
      reason: 'request_mismatch',
    });
    expect(
      resolveOnboardResponseEnvelope(
        envelope({ payload: { type: 'Other', data: { group } } }),
        requestId,
        localPubkey,
      ),
    ).toEqual({ kind: 'ignore', reason: 'wrong_payload_type' });
    expect(
      resolveOnboardResponseEnvelope(
        envelope({ payload: { type: 'OnboardResponse', data: { group: { ...group, members: [] } } } }),
        requestId,
        localPubkey,
      ),
    ).toEqual({ kind: 'ignore', reason: 'malformed' });
    expect(
      resolveOnboardResponseEnvelope(
        envelope({
          payload: {
            type: 'OnboardResponse',
            data: {
              group: { ...group, members: [{ idx: 2, pubkey: peerPubkey }] },
              nonces: [],
            },
          },
        }),
        requestId,
        localPubkey,
      ),
    ).toEqual({ kind: 'ignore', reason: 'peer_not_in_group' });
  });
});
