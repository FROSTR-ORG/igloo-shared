import { describe, expect, test } from 'vitest';

import type { RuntimeStatusSummary } from './wire';

import {
  countKnownPeers,
  countOnlinePeers,
  hasPendingSigns,
  selectActivePeers,
  selectNoncePoolCapacity,
  selectOnboardingStatuses,
  selectPeerPermissionStates,
  selectPendingOperations,
  selectReadinessExplanation,
} from './runtime-projections';

import fixture from '../tests/fixtures/runtime-status.example.json';

const status = fixture as RuntimeStatusSummary;

describe('runtime-projections', () => {
  test('selectActivePeers returns online & known peers', () => {
    const active = selectActivePeers(status);
    expect(active).toHaveLength(1);
    expect(active[0]!.pubkey).toBe(
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    );
    expect(active.every((peer) => peer.online && peer.known)).toBe(true);
  });

  test('selectPendingOperations returns the pending op list', () => {
    const ops = selectPendingOperations(status);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.op_type).toBe('sign');
    expect(ops[0]!.request_id).toBe('req-0001');
  });

  test('selectPeerPermissionStates returns the permission states', () => {
    const states = selectPeerPermissionStates(status);
    expect(states).toHaveLength(2);
    expect(states.map((s) => s.pubkey)).toContain(
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    );
  });

  test('selectOnboardingStatuses returns statuses from the fixture', () => {
    const onboarding = selectOnboardingStatuses(status);
    expect(onboarding).toHaveLength(1);
    expect(onboarding[0]!.stage).toBe('handshake_completed');
  });

  test('selectOnboardingStatuses defaults to [] when absent', () => {
    const { onboarding_statuses: _omit, ...rest } = status;
    expect(selectOnboardingStatuses(rest as RuntimeStatusSummary)).toEqual([]);
  });

  test('selectReadinessExplanation wraps deriveReadinessExplanation', () => {
    const explanation = selectReadinessExplanation(status);
    expect(explanation.runtime_ready).toBe(true);
    expect(explanation.sign_ready).toBe(true);
    expect(explanation.ecdh_ready).toBe(false);
    expect(explanation.threshold).toBe(2);
    // operations block is derived from peers
    expect(explanation.operations.sign_initiator_peers).toEqual([
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    ]);
  });

  test('countOnlinePeers counts online peers', () => {
    expect(countOnlinePeers(status)).toBe(1);
  });

  test('countKnownPeers counts known peers', () => {
    expect(countKnownPeers(status)).toBe(2);
  });

  test('hasPendingSigns detects a pending sign operation', () => {
    expect(hasPendingSigns(status)).toBe(true);
  });

  test('hasPendingSigns is false with no sign ops', () => {
    const noSigns: RuntimeStatusSummary = { ...status, pending_operations: [] };
    expect(hasPendingSigns(noSigns)).toBe(false);
  });

  test('selectNoncePoolCapacity returns undefined (no capacity on wire shape)', () => {
    expect(selectNoncePoolCapacity(status)).toBeUndefined();
  });
});
