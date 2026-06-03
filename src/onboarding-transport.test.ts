import { describe, expect, test } from 'vitest';

import {
  parseBridgeEnvelope,
  parseEventJson,
  parseOnboardingRequestBundle,
} from './onboarding-transport';

// PR-I4 (R3 / Bucket I): onboarding-defenses.test.ts already covers the decrypt
// rate-limit counter and validateOnboardingGroup. This file complements it with
// the onboarding/bridge wire PARSERS, which had no direct coverage.

describe('parseBridgeEnvelope', () => {
  test('parses a well-formed envelope and coerces sent_at to a number', () => {
    const raw = JSON.stringify({
      request_id: 'req-1',
      sent_at: '1700000000',
      payload: { type: 'Sign', data: { foo: 1 } },
    });
    expect(parseBridgeEnvelope(raw)).toEqual({
      request_id: 'req-1',
      sent_at: 1700000000,
      payload: { type: 'Sign', data: { foo: 1 } },
    });
  });

  test('defaults sent_at to 0 when absent', () => {
    const raw = JSON.stringify({ request_id: 'r', payload: { type: 'Ping' } });
    expect(parseBridgeEnvelope(raw)?.sent_at).toBe(0);
  });

  test('returns null on bad JSON, missing request_id, or missing payload.type', () => {
    expect(parseBridgeEnvelope('{not json')).toBeNull();
    expect(parseBridgeEnvelope(JSON.stringify({ payload: { type: 'Ping' } }))).toBeNull();
    expect(
      parseBridgeEnvelope(JSON.stringify({ request_id: 'r', payload: { data: {} } }))
    ).toBeNull();
    expect(parseBridgeEnvelope(JSON.stringify({ request_id: 'r', payload: 'x' }))).toBeNull();
    expect(parseBridgeEnvelope(JSON.stringify(5))).toBeNull();
  });
});

describe('parseOnboardingRequestBundle', () => {
  const valid = {
    request_id: 'r1',
    local_pubkey32: 'ab'.repeat(32),
    request_nonces: [],
    bootstrap_state_hex: 'deadbeef',
    event_json: '{"id":"e"}',
  };

  test('returns the bundle when every required field is present', () => {
    expect(parseOnboardingRequestBundle(JSON.stringify(valid))).toMatchObject({
      request_id: 'r1',
    });
  });

  test('throws a specific error for each missing/invalid field', () => {
    expect(() => parseOnboardingRequestBundle(JSON.stringify(5))).toThrow(
      'Invalid onboarding request bundle'
    );
    expect(() =>
      parseOnboardingRequestBundle(JSON.stringify({ ...valid, request_id: '  ' }))
    ).toThrow('Invalid onboarding request id');
    expect(() =>
      parseOnboardingRequestBundle(JSON.stringify({ ...valid, local_pubkey32: '' }))
    ).toThrow('Invalid onboarding local pubkey');
    expect(() =>
      parseOnboardingRequestBundle(JSON.stringify({ ...valid, request_nonces: 'x' }))
    ).toThrow('Invalid onboarding request nonces');
    expect(() =>
      parseOnboardingRequestBundle(JSON.stringify({ ...valid, bootstrap_state_hex: '' }))
    ).toThrow('Invalid onboarding bootstrap state');
    expect(() =>
      parseOnboardingRequestBundle(JSON.stringify({ ...valid, event_json: '' }))
    ).toThrow('Invalid onboarding request event');
  });
});

describe('parseEventJson', () => {
  test('returns a parsed record', () => {
    expect(parseEventJson('{"id":"e","kind":1}', 'event')).toMatchObject({ id: 'e', kind: 1 });
  });

  test('throws a context-tagged error for non-record JSON', () => {
    expect(() => parseEventJson('5', 'ping event')).toThrow('Invalid ping event');
  });
});
