import { describe, expect, test, vi } from 'vitest';

import {
  createPendingBridgeCommandState,
  matchBridgeCompletion,
  type PendingBridgeCommand,
  type PendingBridgeCommandKind,
  type PendingBridgeCommandState,
} from './runtime-pump';
import {
  EVENT_SCHEMAS,
  hasEventSchema,
  sanitizeDetails,
} from './observability-schema';

type Plumbing = {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  resolveMock: ReturnType<typeof vi.fn>;
  rejectMock: ReturnType<typeof vi.fn>;
};

function enqueue(
  state: PendingBridgeCommandState,
  requestId: string,
  kind: PendingBridgeCommandKind,
): Plumbing {
  const resolveMock = vi.fn();
  const rejectMock = vi.fn();
  const plumbing: Plumbing = {
    resolve: (value: string) => resolveMock(value),
    reject: (error: Error) => rejectMock(error),
    resolveMock,
    rejectMock,
  };
  const entry: PendingBridgeCommand = {
    requestId,
    kind,
    resolve: plumbing.resolve,
    reject: plumbing.reject,
    // Use a dummy handle; we never fire it in these tests.
    timeoutHandle: setTimeout(() => undefined, 0) as ReturnType<typeof setTimeout>,
    status: 'pending',
  };
  state.commands.set(requestId, entry);
  state.kindFifo[kind].push(requestId);
  return plumbing;
}

function markTimedOut(state: PendingBridgeCommandState, requestId: string) {
  const entry = state.commands.get(requestId);
  if (!entry) throw new Error(`missing pending entry for ${requestId}`);
  entry.status = 'timed_out';
}

describe('D.3 request_id correlation', () => {
  test('stale_sign_completion_does_not_resolve_next_command', () => {
    // Issue sign A, time it out, then issue sign B. A late completion for A
    // must NOT resolve B.
    const state = createPendingBridgeCommandState();
    const clientA = 'client-A';
    const clientB = 'client-B';

    const pA = enqueue(state, clientA, 'sign');
    // Simulate the bridge timeout firing for A before any completion arrives.
    markTimedOut(state, clientA);

    const pB = enqueue(state, clientB, 'sign');
    expect(pB.resolveMock).not.toHaveBeenCalled();

    // Late completion for A arrives. Because A is still in the FIFO as a
    // tombstone, dispatch consumes it first and the completion is surfaced
    // as stale — B's promise is untouched.
    const outcome = matchBridgeCompletion(state, 'sign', 'bifrost-req-A');

    expect(outcome.kind).toBe('stale');
    expect(pA.resolveMock).not.toHaveBeenCalled();
    expect(pA.rejectMock).not.toHaveBeenCalled();
    expect(pB.resolveMock).not.toHaveBeenCalled();
    expect(pB.rejectMock).not.toHaveBeenCalled();

    // B is still pending and in the FIFO; its eventual completion resolves it.
    expect(state.commands.has(clientB)).toBe(true);
    expect(state.kindFifo.sign).toEqual([clientB]);

    const outcomeB = matchBridgeCompletion(state, 'sign', 'bifrost-req-B');
    expect(outcomeB.kind).toBe('resolved');
    if (outcomeB.kind === 'resolved') {
      expect(outcomeB.entry.requestId).toBe('bifrost-req-B');
      expect(outcomeB.entry.kind).toBe('sign');
    }
    // After dispatch, B is gone from the state.
    expect(state.commands.size).toBe(0);
    expect(state.kindFifo.sign).toEqual([]);
  });

  test('concurrent_sign_and_ecdh_dispatched_correctly', () => {
    // Two different kinds in flight simultaneously. Completions may arrive in
    // either order; each must dispatch to its own pending entry.
    const state = createPendingBridgeCommandState();
    const pSign = enqueue(state, 'client-sign', 'sign');
    const pEcdh = enqueue(state, 'client-ecdh', 'ecdh');

    // Ecdh completion arrives first (out-of-order vs submission).
    const ecdhOutcome = matchBridgeCompletion(state, 'ecdh', 'brs-ecdh-id');
    expect(ecdhOutcome.kind).toBe('resolved');
    if (ecdhOutcome.kind === 'resolved') {
      expect(ecdhOutcome.entry.kind).toBe('ecdh');
      expect(ecdhOutcome.entry.resolve).toBe(pEcdh.resolve);
      expect(ecdhOutcome.entry.requestId).toBe('brs-ecdh-id');
    }

    // Sign completion arrives second.
    const signOutcome = matchBridgeCompletion(state, 'sign', 'brs-sign-id');
    expect(signOutcome.kind).toBe('resolved');
    if (signOutcome.kind === 'resolved') {
      expect(signOutcome.entry.kind).toBe('sign');
      expect(signOutcome.entry.resolve).toBe(pSign.resolve);
      expect(signOutcome.entry.requestId).toBe('brs-sign-id');
    }

    expect(state.commands.size).toBe(0);
    expect(state.kindFifo.sign).toEqual([]);
    expect(state.kindFifo.ecdh).toEqual([]);
  });

  test('unknown_request_id_emits_stale_outcome_when_no_pending', () => {
    // A completion arrives for a kind that has no in-flight commands: must
    // surface as stale, never throw, and leave state untouched.
    const state = createPendingBridgeCommandState();

    const outcome = matchBridgeCompletion(state, 'sign', 'unknown-req-id');

    expect(outcome.kind).toBe('stale');
    if (outcome.kind === 'stale') {
      expect(outcome.requestId).toBe('unknown-req-id');
      expect(outcome.op).toBe('sign');
    }
    expect(state.commands.size).toBe(0);
    expect(state.kindFifo.sign).toEqual([]);
  });

  test('fast_path_resolves_by_request_id_when_known', () => {
    // If a pending entry is already keyed by the bifrost-rs id (e.g. after
    // re-keying, or after a future bridge change starts echoing the client
    // id), dispatch takes the fast path and does not touch the FIFO for
    // other pending entries.
    const state = createPendingBridgeCommandState();
    const pA = enqueue(state, 'brs-known-id', 'sign');
    const pB = enqueue(state, 'client-next', 'sign');

    const outcome = matchBridgeCompletion(state, 'sign', 'brs-known-id');
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind === 'resolved') {
      expect(outcome.entry.resolve).toBe(pA.resolve);
    }
    // FIFO entry for A is removed; B is still pending and first in line.
    expect(state.kindFifo.sign).toEqual(['client-next']);
    expect(state.commands.has('client-next')).toBe(true);
    expect(pB.resolveMock).not.toHaveBeenCalled();
  });

  test('timed_out_entry_surfaces_as_stale_on_fast_path_too', () => {
    const state = createPendingBridgeCommandState();
    enqueue(state, 'brs-req', 'sign');
    markTimedOut(state, 'brs-req');

    const outcome = matchBridgeCompletion(state, 'sign', 'brs-req');
    expect(outcome.kind).toBe('stale');
    // Entry and FIFO slot are cleaned up after consumption.
    expect(state.commands.size).toBe(0);
    expect(state.kindFifo.sign).toEqual([]);
  });

  test('ecdh_completion_does_not_resolve_pending_sign_of_different_kind', () => {
    // Kind mismatch on the fast path (id collides by accident) or the slow
    // path (no pending of that kind) both surface as stale without touching
    // the other kind's FIFO.
    const state = createPendingBridgeCommandState();
    const pSign = enqueue(state, 'client-sign', 'sign');

    const outcome = matchBridgeCompletion(state, 'ecdh', 'some-id');
    expect(outcome.kind).toBe('stale');
    expect(pSign.resolveMock).not.toHaveBeenCalled();
    expect(pSign.rejectMock).not.toHaveBeenCalled();
    // Sign FIFO is untouched.
    expect(state.kindFifo.sign).toEqual(['client-sign']);
  });

  test('unknown_request_id_emits_observability_event', () => {
    // The Bucket D allow-list redactor must carry a `runtime.stale_completion`
    // schema entry, and the fields the runtime emits on that event must pass
    // the sanitize-details gate. If a future edit drops or renames the entry,
    // stale completions would silently drop from observability output.
    expect(hasEventSchema('runtime', 'stale_completion')).toBe(true);
    expect(EVENT_SCHEMAS.runtime.stale_completion).toEqual(['request_id', 'kind']);

    // Simulate the emitLog payload the runtime produces on a stale completion
    // and confirm the allow-list preserves both fields while dropping any
    // other field an adversary or future regression might attach.
    const sanitized = sanitizeDetails('runtime', 'stale_completion', {
      request_id: 'req-X',
      kind: 'sign',
      // Adversarial extras that must NOT leak to observability output:
      seckey: 'LEAK',
      signature_secret_share: 'LEAK',
    });
    expect(sanitized).toEqual({ request_id: 'req-X', kind: 'sign' });
  });
});
