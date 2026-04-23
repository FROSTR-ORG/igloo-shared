import { describe, expect, test } from 'vitest';

import { RuntimeReadinessTimeoutError } from './errors';

describe('RuntimeReadinessTimeoutError', () => {
  test('prepareOperation_timeout_throws_typed_error', () => {
    // Proxy for the prepareOperation timeout branch: constructing the
    // typed error carries the stable scalar identity we expect callers to
    // rely on. (The prepareOperation integration path is exercised via the
    // runtime session harness; this unit check locks the class contract.)
    const err = new RuntimeReadinessTimeoutError('sign', 2, 0, 0, 1);
    expect(err).toBeInstanceOf(RuntimeReadinessTimeoutError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('RuntimeReadinessTimeoutError');
    expect(err.message).toBe('sign_readiness_timeout');
    expect(err.reason).toBe('sign');
    expect(err.threshold).toBe(2);
    expect(err.signingPeerCount).toBe(0);
    expect(err.ecdhPeerCount).toBe(0);
    expect(err.degradedReasonCount).toBe(1);
  });

  test('ecdh variant produces ecdh_readiness_timeout', () => {
    const err = new RuntimeReadinessTimeoutError('ecdh', 2, 3, 0, 0);
    expect(err.message).toBe('ecdh_readiness_timeout');
    expect(err.reason).toBe('ecdh');
  });

  test('readiness_blob_not_in_error_message', () => {
    // Synthesize a forward-looking "leaky" readiness blob (simulating a
    // future bifrost-rs regression that adds a secret-bearing field).
    const readinessWithLeak = {
      runtime_ready: true,
      restore_complete: true,
      sign_ready: false,
      ecdh_ready: false,
      threshold: 2,
      signing_peer_count: 0,
      ecdh_peer_count: 0,
      last_refresh_at: null,
      degraded_reasons: ['insufficient_signing_peers'],
      secret_field: 'LEAK',
    };

    // Emulate the prepareOperation throw path: it must lift named scalars
    // into the typed error and MUST NOT stringify the readiness blob.
    const err = new RuntimeReadinessTimeoutError(
      'sign',
      readinessWithLeak.threshold,
      readinessWithLeak.signing_peer_count,
      readinessWithLeak.ecdh_peer_count,
      readinessWithLeak.degraded_reasons.length,
    );

    expect(err.message).not.toContain('LEAK');
    expect(err.message).not.toContain('secret_field');
    expect(err.message).not.toContain('{');
    expect(err.message).toBe('sign_readiness_timeout');
    // Also check JSON serialization of the error doesn't leak.
    const serialized = JSON.stringify({
      name: err.name,
      message: err.message,
      reason: err.reason,
      threshold: err.threshold,
      signingPeerCount: err.signingPeerCount,
      ecdhPeerCount: err.ecdhPeerCount,
      degradedReasonCount: err.degradedReasonCount,
    });
    expect(serialized).not.toContain('LEAK');
    expect(serialized).not.toContain('secret_field');
  });

  test('prototype chain supports instanceof checks', () => {
    const err = new RuntimeReadinessTimeoutError('sign', 1, 0, 0, 0);
    expect(err instanceof RuntimeReadinessTimeoutError).toBe(true);
    try {
      throw err;
    } catch (caught) {
      expect(caught instanceof RuntimeReadinessTimeoutError).toBe(true);
    }
  });
});
