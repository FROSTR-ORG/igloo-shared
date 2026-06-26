import { describe, expect, test } from 'vitest';

import { EVENT_SCHEMAS, hasEventSchema, sanitizeDetails } from './observability-schema';
import { createObservabilityEvent } from './observability';

describe('allow-list redactor', () => {
  test('redactor_drops_unknown_field', () => {
    const out = sanitizeDetails('runtime', 'completion', {
      request_id: 'req-1',
      kind: 'sign',
      seckey: 'LEAK',
      password: 'LEAK',
      share_secret: 'LEAK',
    });
    expect(out).toEqual({ request_id: 'req-1', kind: 'sign' });
    expect(out).not.toHaveProperty('seckey');
    expect(out).not.toHaveProperty('password');
  });

  test('redactor_missing_schema_returns_empty_object', () => {
    expect(sanitizeDetails('unknown-domain', 'anything', { foo: 1 })).toEqual({});
    expect(sanitizeDetails('runtime', 'nonexistent-action', { foo: 1 })).toEqual({});
  });

  test('redactor returns empty object when details omitted', () => {
    expect(sanitizeDetails('runtime', 'completion')).toEqual({});
  });

  test('known schema entries are registered', () => {
    expect(hasEventSchema('runtime', 'completion')).toBe(true);
    expect(hasEventSchema('runtime', 'failure')).toBe(true);
    expect(hasEventSchema('runtime', 'inbound_accepted')).toBe(true);
    expect(hasEventSchema('sign', 'complete')).toBe(true);
    expect(hasEventSchema('ecdh', 'complete')).toBe(true);
    expect(hasEventSchema('ping', 'complete')).toBe(true);
    expect(hasEventSchema('ping', 'failure')).toBe(true);
    expect(hasEventSchema('relay', 'inbound_event')).toBe(true);
    expect(hasEventSchema('relay', 'publish_complete')).toBe(true);
    expect(hasEventSchema('onboarding', 'peer_onboarded')).toBe(true);
    expect(hasEventSchema('onboarding', 'request_complete')).toBe(true);
    expect(hasEventSchema('bogus', 'bogus')).toBe(false);
  });

  test('operation completion schemas keep safe dashboard metadata', () => {
    expect(
      sanitizeDetails('sign', 'complete', {
        request_id: 'req-sign',
        signature_count: 1,
        message: 'Sign request completed',
        signature_secret_share: 'LEAK',
      }),
    ).toEqual({
      request_id: 'req-sign',
      signature_count: 1,
      message: 'Sign request completed',
    });
    expect(
      sanitizeDetails('ping', 'complete', {
        request_id: 'req-ping',
        peer: 'peer-pubkey',
        elapsed_ms: 17,
        message: 'Ping completed in 17ms',
        password: 'LEAK',
      }),
    ).toEqual({
      request_id: 'req-ping',
      peer: 'peer-pubkey',
      elapsed_ms: 17,
      message: 'Ping completed in 17ms',
    });
  });

  test('runtime failure schema keeps safe scalar failure metadata', () => {
    expect(
      sanitizeDetails('runtime', 'failure', {
        request_id: 'req-1',
        op_type: 'sign',
        message: 'operation failed',
        reason_code: 'timeout',
        failed_peer: 'peer-pubkey',
        secret: 'LEAK',
      }),
    ).toEqual({
      request_id: 'req-1',
      op_type: 'sign',
      message: 'operation failed',
      reason_code: 'timeout',
      failed_peer: 'peer-pubkey',
    });
  });

  test('schema entries only list scalar-safe field names', () => {
    // Guard: no schema entry should list a forbidden field name. New code
    // that tries to register one of these should fail this test loudly.
    const forbidden = new Set([
      'password',
      'passphrase',
      'seckey',
      'share_secret',
      'shareSecret',
      'state_hex',
      'stateHex',
      'snapshot',
      'snapshotJson',
      'runtime_snapshot_json',
      'runtimeSnapshotJson',
      'onboardPackage',
      'completion',
      'failure',
    ]);
    for (const [domain, actions] of Object.entries(EVENT_SCHEMAS)) {
      for (const [action, fields] of Object.entries(actions)) {
        for (const field of fields) {
          expect(
            forbidden.has(field),
            `forbidden field "${field}" registered on ${domain}.${action}`,
          ).toBe(false);
        }
      }
    }
  });
});

describe('redactor red-team fuzz', () => {
  // Fixture secret values the adversary might try to smuggle through.
  const FIXTURES = [
    '11'.repeat(32),
    'fa'.repeat(32),
    'deadbeef'.repeat(8),
    'SECRET_LEAK_MARKER',
    'passwordValue!',
    'shareSecretValue',
  ];

  // A corpus of plausible payloads the runtime might see. Each entry pairs a
  // realistic event with a payload that sneaks secret fixtures into fields
  // that are NOT in the schema. The serialized log output must not contain
  // any fixture.
  const CORPUS: Array<{
    domain: string;
    action: string;
    payload: Record<string, unknown>;
  }> = [
    {
      domain: 'runtime',
      action: 'completion',
      payload: {
        request_id: 'req-1',
        kind: 'sign',
        // Adversary tries to add bifrost-rs fields:
        seckey: FIXTURES[0],
        share_secret: FIXTURES[1],
        nonce: FIXTURES[2],
        signature_secret_share: FIXTURES[3],
        // Nested shapes:
        raw: { inner: { seckey: FIXTURES[0] } },
      },
    },
    {
      domain: 'runtime',
      action: 'failure',
      payload: {
        op_type: 'sign',
        message: 'operation failed',
        request_id: 'req-2',
        code: 'timeout',
        failed_peer: 'peer-pubkey',
        elapsed_ms: 100,
        context: {
          share: { seckey: FIXTURES[0] },
          password: FIXTURES[4],
        },
      },
    },
    {
      domain: 'onboarding',
      action: 'request_complete',
      payload: {
        request_id: 'req-3',
        peer_pubkey32: 'abc',
        share_pubkey32: 'def',
        // Adversarial extra:
        share_secret: FIXTURES[1],
        password: FIXTURES[4],
      },
    },
    {
      domain: 'runtime',
      action: 'status_event',
      payload: {
        kind: 'sign',
        sign_ready: true,
        ecdh_ready: false,
        pending_ops: 2,
        readiness: {
          secret_field: FIXTURES[3],
        },
      },
    },
    {
      domain: 'runtime',
      action: 'restored',
      payload: {
        mode: 'persisted',
        peers: ['peer1', 'peer2'],
        public_key: 'pk',
        snapshot: { share: { seckey: FIXTURES[0] } },
      },
    },
    {
      domain: 'onboarding',
      action: 'decrypt_cap_reached',
      payload: {
        request_id: 'req-4',
        payload_snippet: FIXTURES[5],
      },
    },
    {
      // Completely unknown event -> fail closed to {}.
      domain: 'runtime',
      action: 'nonexistent_event',
      payload: {
        seckey: FIXTURES[0],
        password: FIXTURES[4],
      },
    },
  ];

  test('fuzz: no fixture value appears in serialized output', () => {
    const joined: string[] = [];
    for (const entry of CORPUS) {
      const safe = sanitizeDetails(entry.domain, entry.action, entry.payload);
      joined.push(JSON.stringify(safe));
      const event = createObservabilityEvent(
        'info',
        'test-component',
        entry.domain,
        entry.action,
        entry.payload,
      );
      joined.push(JSON.stringify(event));
    }
    const serialized = joined.join('\n');
    for (const fixture of FIXTURES) {
      expect(
        serialized.includes(fixture),
        `fixture ${fixture} leaked into serialized log output`,
      ).toBe(false);
    }
  });
});
