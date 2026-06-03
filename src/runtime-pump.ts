// Runtime pump helpers.
//
// PR30: extracted verbatim from `browser-runtime-core.ts`. Holds the
// request_id-keyed pending-bridge-command map (and its types), the
// completion-dispatch correlation logic, and the completion/failure payload
// parsers consumed by the tick/drain loop. The tick loop itself lives on
// `BrowserBridgeNode` (`wasm-bridge-node.ts`) since it drives WASM-backed
// state; the pure correlation + parsing helpers live here so they can be
// unit-tested without instantiating the full node.

import { isRecord } from './runtime-internal';

/** @internal */
export type PendingBridgeCommandKind = 'sign' | 'ecdh';

/**
 * Pending bridge command entry. Dispatch is keyed by `requestId` — the
 * identifier used to correlate the command with its completion. `kind` is
 * retained for observability only; it is NOT used for correlation.
 *
 * `status` tracks whether a timeout has already consumed the promise. A
 * timed-out entry is kept in the per-kind FIFO as a tombstone so that a
 * late-arriving completion matches against it (and is surfaced as a stale
 * completion observability event) instead of silently binding to a newer
 * in-flight command of the same kind.
 *
 * @internal
 */
export type PendingBridgeCommand = {
  requestId: string;
  kind: PendingBridgeCommandKind;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  status: 'pending' | 'timed_out';
};

/**
 * Mutable state shared between `runBridgeCommand`, the runtime-pump
 * dispatcher, and shutdown. Split out as a struct so the correlation logic
 * can be unit-tested without instantiating the full WASM-backed node.
 *
 * @internal
 */
export type PendingBridgeCommandState = {
  commands: Map<string, PendingBridgeCommand>;
  kindFifo: Record<PendingBridgeCommandKind, string[]>;
};

/** @internal */
export function createPendingBridgeCommandState(): PendingBridgeCommandState {
  return {
    commands: new Map(),
    kindFifo: { sign: [], ecdh: [] },
  };
}

/**
 * Outcome of dispatching a completion against the pending-command state.
 * Exposed so tests can observe dispatch decisions without touching the
 * resolve/reject plumbing.
 *
 * @internal
 */
export type BridgeDispatchOutcome =
  | { kind: 'resolved'; entry: PendingBridgeCommand }
  | { kind: 'stale'; requestId: string; op: PendingBridgeCommandKind };

/**
 * Match a completion's `(kind, request_id)` against the pending-command
 * state. Removes the matched entry (whether consumed or stale) and returns
 * a description of what happened.
 *
 * @internal
 */
export function matchBridgeCompletion(
  state: PendingBridgeCommandState,
  kind: PendingBridgeCommandKind,
  completionRequestId: string,
): BridgeDispatchOutcome {
  const direct = state.commands.get(completionRequestId);
  if (direct && direct.kind === kind) {
    state.commands.delete(completionRequestId);
    const fifo = state.kindFifo[kind];
    const idx = fifo.indexOf(completionRequestId);
    if (idx >= 0) fifo.splice(idx, 1);
    if (direct.status === 'pending') {
      return { kind: 'resolved', entry: direct };
    }
    return { kind: 'stale', requestId: completionRequestId, op: kind };
  }

  const fifo = state.kindFifo[kind];
  const oldestKey = fifo.shift();
  if (oldestKey === undefined) {
    return { kind: 'stale', requestId: completionRequestId, op: kind };
  }
  const entry = state.commands.get(oldestKey);
  state.commands.delete(oldestKey);
  if (!entry) {
    return { kind: 'stale', requestId: completionRequestId, op: kind };
  }
  if (entry.status === 'timed_out') {
    return { kind: 'stale', requestId: completionRequestId, op: kind };
  }
  entry.requestId = completionRequestId;
  return { kind: 'resolved', entry };
}

export function parsePingCompletion(completion: unknown): { requestId: string; peer: string } | null {
  if (!isRecord(completion)) return null;
  const payload = completion.Ping;
  if (!isRecord(payload)) return null;

  const requestId = payload.request_id;
  const peer = payload.peer;
  if (typeof requestId !== 'string' || typeof peer !== 'string') return null;
  return { requestId, peer };
}

export function parseSignCompletion(
  completion: unknown
): { requestId: string; signatures: string[] } | null {
  if (!isRecord(completion)) return null;
  const payload = completion.Sign;
  if (!isRecord(payload) || !Array.isArray(payload.signatures_hex64)) return null;
  if (typeof payload.request_id !== 'string') return null;
  const signatures = payload.signatures_hex64.filter(
    (value): value is string => typeof value === 'string'
  );
  return signatures.length > 0
    ? { requestId: payload.request_id, signatures }
    : null;
}

export function parseEcdhCompletion(
  completion: unknown
): { requestId: string; sharedSecretHex32: string } | null {
  if (!isRecord(completion)) return null;
  const payload = completion.Ecdh;
  if (!isRecord(payload) || typeof payload.shared_secret_hex32 !== 'string') return null;
  if (typeof payload.request_id !== 'string') return null;
  return {
    requestId: payload.request_id,
    sharedSecretHex32: payload.shared_secret_hex32.toLowerCase(),
  };
}

/**
 * Parse an `OnboardServed` completion (Paper onboard-served seam). Unlike
 * sign/ecdh, this is a fire-and-forget notification with no pending command to
 * correlate, so it only surfaces the onboarded peer's 32-byte x-only pubkey.
 */
export function parseOnboardServedCompletion(
  completion: unknown
): { peerPubkey: string } | null {
  if (!isRecord(completion)) return null;
  const payload = completion.OnboardServed;
  if (!isRecord(payload) || typeof payload.peer_pubkey32_hex !== 'string') return null;
  return { peerPubkey: payload.peer_pubkey32_hex.toLowerCase() };
}

export function parseOperationFailure(
  failure: unknown
): { opType: string; message: string } | null {
  if (!isRecord(failure)) return null;
  if (typeof failure.op_type !== 'string' || typeof failure.message !== 'string') return null;
  return { opType: failure.op_type, message: failure.message };
}

/**
 * Extract the kind tag from a completion payload without pulling any
 * structured (secret-bearing) sub-fields. Returns `'ping' | 'sign' | 'ecdh'`
 * when the payload matches a known shape; `'unknown'` otherwise.
 */
export function completionKind(completion: unknown): string {
  if (!isRecord(completion)) return 'unknown';
  if (isRecord(completion.Ping)) return 'ping';
  if (isRecord(completion.Sign)) return 'sign';
  if (isRecord(completion.Ecdh)) return 'ecdh';
  return 'unknown';
}

/** Extract `request_id` from a completion payload, or return `undefined`. */
export function completionRequestId(completion: unknown): string | undefined {
  if (!isRecord(completion)) return undefined;
  for (const payload of [completion.Ping, completion.Sign, completion.Ecdh]) {
    if (isRecord(payload) && typeof payload.request_id === 'string') {
      return payload.request_id;
    }
  }
  return undefined;
}

/** Extract `request_id` from a failure payload, or return `undefined`. */
export function failureRequestId(failure: unknown): string | undefined {
  if (!isRecord(failure)) return undefined;
  return typeof failure.request_id === 'string' ? failure.request_id : undefined;
}

export function clearPendingCommand(pending: PendingBridgeCommand | null | undefined) {
  if (!pending) return;
  clearTimeout(pending.timeoutHandle);
}
