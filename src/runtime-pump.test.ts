import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  clearPendingCommand,
  completionKind,
  completionRequestId,
  failureRequestId,
  parseEcdhCompletion,
  parseOperationFailure,
  parsePingCompletion,
  parseSignCompletion,
  type PendingBridgeCommand,
} from './runtime-pump';

// PR-I4 (R3 / Bucket I): bridge-dispatch.test.ts already covers
// matchBridgeCompletion exhaustively. This file complements it with the
// completion/failure payload PARSERS and the small request_id extractors that
// the dispatch loop relies on, which had no direct coverage.

describe('parseSignCompletion', () => {
  test('parses a well-formed sign completion', () => {
    expect(
      parseSignCompletion({ Sign: { request_id: 'r1', signatures_hex64: ['ab', 'cd'] } })
    ).toEqual({ requestId: 'r1', signatures: ['ab', 'cd'] });
  });

  test('drops non-string signature entries but keeps the rest', () => {
    expect(
      parseSignCompletion({ Sign: { request_id: 'r1', signatures_hex64: ['ab', 5, null] } })
    ).toEqual({ requestId: 'r1', signatures: ['ab'] });
  });

  test('returns null on empty signatures, missing request_id, or wrong shape', () => {
    expect(parseSignCompletion({ Sign: { request_id: 'r1', signatures_hex64: [] } })).toBeNull();
    expect(parseSignCompletion({ Sign: { signatures_hex64: ['ab'] } })).toBeNull();
    expect(parseSignCompletion({ Sign: { request_id: 'r1', signatures_hex64: 'ab' } })).toBeNull();
    expect(parseSignCompletion({ Ping: {} })).toBeNull();
    expect(parseSignCompletion('nope')).toBeNull();
  });
});

describe('parseEcdhCompletion', () => {
  test('parses and lowercases the shared secret', () => {
    expect(
      parseEcdhCompletion({ Ecdh: { request_id: 'r2', shared_secret_hex32: 'ABCDEF' } })
    ).toEqual({ requestId: 'r2', sharedSecretHex32: 'abcdef' });
  });

  test('returns null when the secret or request_id is missing or mistyped', () => {
    expect(parseEcdhCompletion({ Ecdh: { request_id: 'r2' } })).toBeNull();
    expect(parseEcdhCompletion({ Ecdh: { shared_secret_hex32: 'ab' } })).toBeNull();
    expect(parseEcdhCompletion({ Ecdh: { request_id: 5, shared_secret_hex32: 'ab' } })).toBeNull();
    expect(parseEcdhCompletion(null)).toBeNull();
  });
});

describe('parsePingCompletion', () => {
  test('parses request_id and peer', () => {
    expect(parsePingCompletion({ Ping: { request_id: 'r3', peer: 'pub' } })).toEqual({
      requestId: 'r3',
      peer: 'pub',
    });
  });

  test('returns null on missing fields or non-record input', () => {
    expect(parsePingCompletion({ Ping: { request_id: 'r3' } })).toBeNull();
    expect(parsePingCompletion({ Ping: 'x' })).toBeNull();
    expect(parsePingCompletion(42)).toBeNull();
  });
});

describe('parseOperationFailure', () => {
  test('parses op_type and message', () => {
    expect(parseOperationFailure({ op_type: 'sign', message: 'boom' })).toEqual({
      opType: 'sign',
      message: 'boom',
    });
  });

  test('returns null when either field is missing or mistyped', () => {
    expect(parseOperationFailure({ op_type: 'sign' })).toBeNull();
    expect(parseOperationFailure({ message: 'boom' })).toBeNull();
    expect(parseOperationFailure({ op_type: 1, message: 'boom' })).toBeNull();
    expect(parseOperationFailure(undefined)).toBeNull();
  });
});

describe('completionKind', () => {
  test('tags each known completion shape', () => {
    expect(completionKind({ Ping: {} })).toBe('ping');
    expect(completionKind({ Sign: {} })).toBe('sign');
    expect(completionKind({ Ecdh: {} })).toBe('ecdh');
  });

  test('returns "unknown" for unrecognized or non-record payloads', () => {
    expect(completionKind({ Other: {} })).toBe('unknown');
    expect(completionKind('x')).toBe('unknown');
  });
});

describe('completionRequestId / failureRequestId', () => {
  test('extracts request_id from any known completion shape', () => {
    expect(completionRequestId({ Sign: { request_id: 'r1' } })).toBe('r1');
    expect(completionRequestId({ Ecdh: { request_id: 'r2' } })).toBe('r2');
    expect(completionRequestId({ Ping: { request_id: 'r3' } })).toBe('r3');
  });

  test('returns undefined when no request_id is present', () => {
    expect(completionRequestId({ Sign: {} })).toBeUndefined();
    expect(completionRequestId('x')).toBeUndefined();
    expect(failureRequestId({ request_id: 'rf' })).toBe('rf');
    expect(failureRequestId({ message: 'x' })).toBeUndefined();
    expect(failureRequestId(null)).toBeUndefined();
  });
});

describe('clearPendingCommand', () => {
  afterEach(() => vi.restoreAllMocks());

  test('is a no-op for null/undefined', () => {
    expect(() => clearPendingCommand(null)).not.toThrow();
    expect(() => clearPendingCommand(undefined)).not.toThrow();
  });

  test('clears the timeout handle of a pending command', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const handle = setTimeout(() => {}, 10_000);
    const pending = {
      requestId: 'r1',
      kind: 'sign',
      resolve: () => {},
      reject: () => {},
      timeoutHandle: handle,
      status: 'pending',
    } as PendingBridgeCommand;
    clearPendingCommand(pending);
    expect(clearSpy).toHaveBeenCalledWith(handle);
  });
});
