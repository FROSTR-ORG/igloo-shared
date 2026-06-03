import { describe, expect, test } from 'vitest';

import type {
  RuntimePeerPermissionState,
  RuntimePeerStatus,
  RuntimePendingOperation,
  RuntimeStatusSummary,
} from '../src/index';

import fixture from './fixtures/runtime-status.example.json';

/**
 * PR29 wire-type contract test.
 *
 * Guards the extracted `src/wire/` runtime shapes against drift:
 *
 *  (a) a compile-time assignment proves the hand-authored fixture still
 *      satisfies the public `RuntimeStatusSummary` type — if a field is
 *      renamed/removed in `src/wire/runtime.ts`, this stops typechecking; and
 *  (b) a light runtime guard asserts the fixture carries the expected
 *      top-level keys with the expected primitive shapes, so a malformed
 *      fixture or accidental JSON edit is caught at test time too.
 */

// (a) Compile-time check: the JSON fixture must be assignable to the public
// RuntimeStatusSummary type. `as const`-free import keeps this honest.
const _contract: RuntimeStatusSummary = fixture as RuntimeStatusSummary;

describe('PR29 wire-type contract', () => {
  const status: RuntimeStatusSummary = _contract;

  test('fixture exposes the expected top-level RuntimeStatusSummary keys', () => {
    expect(Object.keys(status).sort()).toEqual(
      [
        'metadata',
        'onboarding_statuses',
        'peer_permission_states',
        'peers',
        'pending_operations',
        'readiness',
        'status',
      ].sort(),
    );
  });

  test('status details are the expected scalar shapes', () => {
    expect(typeof status.status.device_id).toBe('string');
    expect(typeof status.status.pending_ops).toBe('number');
    expect(typeof status.status.last_active).toBe('number');
    expect(typeof status.status.known_peers).toBe('number');
    expect(typeof status.status.request_seq).toBe('number');
  });

  test('metadata carries identifiers and a peer list', () => {
    expect(typeof status.metadata.device_id).toBe('string');
    expect(typeof status.metadata.member_idx).toBe('number');
    expect(typeof status.metadata.share_public_key).toBe('string');
    expect(typeof status.metadata.group_public_key).toBe('string');
    expect(Array.isArray(status.metadata.peers)).toBe(true);
    for (const peer of status.metadata.peers) {
      expect(typeof peer).toBe('string');
    }
  });

  test('readiness flags and counts are well typed', () => {
    const r = status.readiness;
    for (const flag of [
      r.runtime_ready,
      r.restore_complete,
      r.sign_ready,
      r.ecdh_ready,
    ]) {
      expect(typeof flag).toBe('boolean');
    }
    expect(typeof r.threshold).toBe('number');
    expect(typeof r.signing_peer_count).toBe('number');
    expect(typeof r.ecdh_peer_count).toBe('number');
    expect(r.last_refresh_at === null || typeof r.last_refresh_at === 'number').toBe(true);
    expect(Array.isArray(r.degraded_reasons)).toBe(true);
  });

  test('peers match the RuntimePeerStatus shape', () => {
    expect(status.peers.length).toBeGreaterThan(0);
    for (const peer of status.peers as RuntimePeerStatus[]) {
      expect(typeof peer.idx).toBe('number');
      expect(typeof peer.pubkey).toBe('string');
      expect(typeof peer.known).toBe('boolean');
      expect(peer.last_seen === null || typeof peer.last_seen === 'number').toBe(true);
      expect(typeof peer.online).toBe('boolean');
      expect(typeof peer.incoming_available).toBe('number');
      expect(typeof peer.outgoing_available).toBe('number');
      expect(typeof peer.outgoing_spent).toBe('number');
      expect(typeof peer.can_sign).toBe('boolean');
      expect(typeof peer.should_send_nonces).toBe('boolean');
    }
  });

  test('peer permission states carry override / observation / effective policy', () => {
    expect(status.peer_permission_states.length).toBeGreaterThan(0);
    for (const state of status.peer_permission_states as RuntimePeerPermissionState[]) {
      expect(typeof state.pubkey).toBe('string');
      expect(typeof state.manual_override.request.sign).toBe('string');
      expect(typeof state.manual_override.respond.ecdh).toBe('string');
      expect(
        state.remote_observation === null ||
          typeof state.remote_observation.revision === 'number',
      ).toBe(true);
      expect(typeof state.effective_policy.request.ping).toBe('boolean');
      expect(typeof state.effective_policy.respond.sign).toBe('boolean');
    }
  });

  test('onboarding statuses use the bounded stage enum', () => {
    const statuses = status.onboarding_statuses ?? [];
    expect(statuses.length).toBeGreaterThan(0);
    for (const entry of statuses) {
      expect(typeof entry.pubkey).toBe('string');
      expect(
        ['device_contacted_host', 'handshake_completed', 'failed'].includes(entry.stage),
      ).toBe(true);
      expect(typeof entry.updated_at).toBe('number');
    }
  });

  test('pending operations match the RuntimePendingOperation shape', () => {
    expect(status.pending_operations.length).toBeGreaterThan(0);
    for (const op of status.pending_operations as RuntimePendingOperation[]) {
      expect(typeof op.op_type).toBe('string');
      expect(typeof op.request_id).toBe('string');
      expect(typeof op.started_at).toBe('number');
      expect(typeof op.timeout_at).toBe('number');
      expect(Array.isArray(op.target_peers)).toBe(true);
      expect(typeof op.threshold).toBe('number');
      expect(Array.isArray(op.collected_responses)).toBe(true);
    }
  });
});
