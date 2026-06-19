// Dev/test-only canonical fixture for the seeded "running dashboard" scenario.
// Consumed ONLY by the clients' import.meta.env.DEV-gated dev-scenario seams via
// the `igloo-shared/testing/dev-fixtures` subpath export — never on the main
// barrel, so production app bundles tree-shake it out.
import type { RuntimePeerStatus, RuntimeReadiness, RuntimeStatusSummary } from '../wire/runtime';

export const FIXTURE_PROFILE_ID = 'dev-scenario-device';
export const FIXTURE_PROFILE_LABEL = 'Dev Signing Key';
export const FIXTURE_GROUP_PK = '02'.repeat(32);
export const FIXTURE_SHARE_PK = '11'.repeat(32);
export const FIXTURE_RELAY = 'ws://127.0.0.1:8194';
export const FIXTURE_MEMBER_IDX = 1;
export const FIXTURE_PEER_A = '03a3f8c2d1'.padEnd(64, '0');
export const FIXTURE_PEER_B = '02d7e1b93b'.padEnd(64, '0');

export const FIXTURE_SIGNER_SETTINGS = {
  sign_timeout_secs: 30,
  ping_timeout_secs: 15,
  request_ttl_secs: 300,
  state_save_interval_secs: 30,
  peer_selection_strategy: 'deterministic_sorted',
} as const;

const FIXTURE_READINESS: RuntimeReadiness = {
  runtime_ready: true,
  restore_complete: true,
  sign_ready: true,
  ecdh_ready: true,
  threshold: 2,
  signing_peer_count: 2,
  ecdh_peer_count: 2,
  last_refresh_at: null,
  degraded_reasons: [],
};

export function createFixturePeer(idx: number, pubkey: string, online: boolean): RuntimePeerStatus {
  return {
    idx,
    pubkey,
    known: true,
    last_seen: online ? 1_700_000_000 : null,
    online,
    incoming_available: online ? 92 : 0,
    outgoing_available: online ? 78 : 0,
    outgoing_spent: online ? 14 : 0,
    can_sign: online,
    can_ecdh: online,
    can_ping: online,
    should_send_nonces: online,
    last_response_latency_ms: online ? 24 : null,
    avg_latency_ms: online ? 31 : null,
    nonce_history: [],
  };
}

export function createFixtureRuntimeStatusSummary(): RuntimeStatusSummary {
  return {
    status: { device_id: FIXTURE_PROFILE_ID, pending_ops: 0, last_active: 1_700_000_000, known_peers: 2, request_seq: 7 },
    metadata: {
      device_id: FIXTURE_PROFILE_ID,
      member_idx: FIXTURE_MEMBER_IDX,
      share_public_key: FIXTURE_SHARE_PK,
      group_public_key: FIXTURE_GROUP_PK,
      peers: [FIXTURE_PEER_A, FIXTURE_PEER_B],
    },
    readiness: FIXTURE_READINESS,
    peers: [createFixturePeer(0, FIXTURE_PEER_A, true), createFixturePeer(2, FIXTURE_PEER_B, false)],
    peer_permission_states: [],
    pending_operations: [],
    pending_approvals: [],
    connected_relays: [FIXTURE_RELAY],
    configured_relays: [FIXTURE_RELAY],
  };
}
