import { describe, expect, test, vi } from 'vitest';

import {
  createSignerNode,
  deriveReadinessExplanation,
  getRuntimeReadiness,
  getRuntimeSnapshot,
  getRuntimeStatus,
  validateOnboardCredential,
  validateOnboardingPassword,
} from './runtime-api';
import { BrowserBridgeNode } from './wasm-bridge-node';

// PR-I4 (R3 / Bucket I): runtime-api.ts is the public free-function facade over
// BrowserBridgeNode. Construction and the read-model delegations had no coverage.

describe('createSignerNode', () => {
  test('constructs a BrowserBridgeNode from a RuntimeConfig', () => {
    const node = createSignerNode({ mode: 'persisted', relays: [] });
    expect(node).toBeInstanceOf(BrowserBridgeNode);
  });
});

describe('runtime read-model delegations', () => {
  test('getRuntimeStatus / getRuntimeSnapshot / getRuntimeReadiness forward to the node', () => {
    const status = { peers: [], readiness: { runtime_ready: true } };
    const snapshot = { snap: 1 };
    const readiness = { runtime_ready: true };
    const node = {
      runtimeStatus: vi.fn(() => status),
      snapshotRuntimeState: vi.fn(() => snapshot),
      runtimeReadiness: vi.fn(() => readiness),
    } as unknown as BrowserBridgeNode;

    expect(getRuntimeStatus(node)).toBe(status);
    expect(getRuntimeSnapshot(node)).toBe(snapshot);
    expect(getRuntimeReadiness(node)).toBe(readiness);
    expect(node.runtimeStatus).toHaveBeenCalledOnce();
    expect(node.snapshotRuntimeState).toHaveBeenCalledOnce();
    expect(node.runtimeReadiness).toHaveBeenCalledOnce();
  });
});

describe('deriveReadinessExplanation', () => {
  test('uses explicit peer ECDH capability when the runtime provides it', () => {
    const explanation = deriveReadinessExplanation({
      status: {
        device_id: 'device-1',
        pending_ops: 0,
        last_active: 1700000000,
        known_peers: 2,
        request_seq: 7,
      },
      metadata: {
        device_id: 'device-1',
        member_idx: 1,
        share_public_key: 'share-pub-1',
        group_public_key: 'group-pub-1',
        peers: ['peer-1', 'peer-2'],
      },
      readiness: {
        runtime_ready: true,
        restore_complete: true,
        sign_ready: false,
        ecdh_ready: false,
        threshold: 2,
        signing_peer_count: 0,
        ecdh_peer_count: 1,
        last_refresh_at: 1700000000,
        degraded_reasons: ['insufficient_ecdh_peers'],
      },
      peers: [
        {
          idx: 2,
          pubkey: 'peer-1',
          known: true,
          last_seen: 1700000000,
          online: true,
          incoming_available: 0,
          outgoing_available: 0,
          outgoing_spent: 0,
          can_sign: false,
          can_ecdh: false,
          can_ping: false,
          should_send_nonces: false,
          last_response_latency_ms: null,
          avg_latency_ms: null,
          nonce_history: [],
        },
        {
          idx: 3,
          pubkey: 'peer-2',
          known: true,
          last_seen: 1700000000,
          online: true,
          incoming_available: 0,
          outgoing_available: 0,
          outgoing_spent: 0,
          can_sign: false,
          can_ecdh: true,
          can_ping: false,
          should_send_nonces: false,
          last_response_latency_ms: null,
          avg_latency_ms: null,
          nonce_history: [],
        },
      ],
      peer_permission_states: [],
      pending_operations: [],
    });

    expect(explanation.operations.ecdh_ready_peers).toEqual(['peer-2']);
    expect(explanation.operations.missing_ecdh_peers).toEqual(['peer-1']);
  });
});

describe('validateOnboardingPassword', () => {
  test('requires a non-empty password of at least 8 characters', () => {
    expect(validateOnboardingPassword('')).toEqual({
      isValid: false,
      error: 'Password is required',
    });
    expect(validateOnboardingPassword('short')).toEqual({
      isValid: false,
      error: 'Password must be at least 8 characters',
    });
    expect(validateOnboardingPassword('longenough')).toEqual({ isValid: true });
  });
});

describe('validateOnboardCredential', () => {
  test('requires a sufficiently long bfonboard1 bech32m string', () => {
    expect(validateOnboardCredential('')).toMatchObject({ isValid: false });
    expect(validateOnboardCredential('not-a-package')).toMatchObject({
      error: 'Onboarding package must start with bfonboard1',
    });
    expect(validateOnboardCredential('bfonboard1!!!notbech32')).toMatchObject({
      error: 'Onboarding package must be valid bech32m text',
    });
    expect(validateOnboardCredential('bfonboard1ac')).toMatchObject({
      error: 'Onboarding package is too short',
    });
    expect(validateOnboardCredential(`bfonboard1${'a'.repeat(40)}`)).toEqual({ isValid: true });
  });
});
