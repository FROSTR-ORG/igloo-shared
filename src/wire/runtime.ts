/**
 * Pure runtime wire-shape type declarations.
 *
 * These describe the JSON projections exchanged with the bifrost-rs WASM
 * runtime (status summaries, readiness, peer/onboarding state, snapshot and
 * bootstrap envelopes). They are intentionally free of runtime/value code so
 * consumers can `import type` them without pulling in the browser runtime.
 *
 * Extracted from `browser-runtime-core.ts` (PR29, Bucket G.1). No behavior
 * changed; only the declarations moved.
 */

import type {
  RuntimeMethodPolicy,
  RuntimeMethodPolicyOverride,
  RuntimePeerPermissionState,
} from './policy';

export type DecodedOnboardingProfile = {
  publicKey: string;
  peerPubkey: string;
  relays: string[];
};

/** One `(ts, held)` nonce-inventory sample for the dashboard sparkline. */
export type RuntimeNonceHistoryPoint = {
  ts: number;
  held: number;
};

export type RuntimePeerStatus = {
  idx: number;
  pubkey: string;
  known: boolean;
  last_seen: number | null;
  online: boolean;
  incoming_available: number;
  outgoing_available: number;
  outgoing_spent: number;
  can_sign: boolean;
  can_ecdh: boolean;
  can_ping: boolean;
  should_send_nonces: boolean;
  /** Most recent PING round-trip latency (ms); null until a ping completes. */
  last_response_latency_ms: number | null;
  /** Rolling-window mean PING latency (ms); null until a ping completes. */
  avg_latency_ms: number | null;
  /** Bounded nonce-held history (oldest first) for the sparkline. */
  nonce_history: RuntimeNonceHistoryPoint[];
};

export type RuntimeMetadata = {
  device_id: string;
  member_idx: number;
  share_public_key: string;
  group_public_key: string;
  peers: string[];
};

export type RuntimeReadiness = {
  runtime_ready: boolean;
  restore_complete: boolean;
  sign_ready: boolean;
  ecdh_ready: boolean;
  threshold: number;
  signing_peer_count: number;
  ecdh_peer_count: number;
  last_refresh_at: number | null;
  degraded_reasons: string[];
};

export type RuntimeOperationReadiness = {
  sign_initiator_ready: boolean;
  sign_responder_ready: boolean;
  ecdh_ready: boolean;
  sign_initiator_peer_count: number;
  sign_responder_peer_count: number;
  ecdh_peer_count: number;
  sign_initiator_peers: string[];
  sign_responder_peers: string[];
  ecdh_ready_peers: string[];
  missing_sign_initiator_peers: string[];
  missing_sign_responder_peers: string[];
  missing_ecdh_peers: string[];
};

export type RuntimeReadinessExplanation = {
  runtime_ready: boolean;
  restore_complete: boolean;
  sign_ready: boolean;
  ecdh_ready: boolean;
  threshold: number;
  signing_peer_count: number;
  ecdh_peer_count: number;
  last_refresh_at: number | null;
  degraded_reasons: string[];
  operations: RuntimeOperationReadiness;
};

export type RuntimeStatusDetails = {
  device_id: string;
  pending_ops: number;
  last_active: number;
  known_peers: number;
  request_seq: number;
};

export type RuntimePendingOperation = {
  op_type: string;
  request_id: string;
  started_at: number;
  timeout_at: number;
  target_peers: string[];
  threshold: number;
  collected_responses: unknown[];
  context: unknown;
};

export type RuntimeOnboardingStatus = {
  pubkey: string;
  stage: 'device_contacted_host' | 'handshake_completed' | 'failed';
  updated_at: number;
  error?: string | null;
};

/**
 * An inbound request parked awaiting an operator decision (the `ask` policy
 * disposition). Mirrors `bifrost_signer::PendingApprovalSummary`. The raw
 * request payload is intentionally not carried — operators decide on peer +
 * method, not on the request bytes.
 */
export type RuntimePendingApproval = {
  request_id: string;
  peer: string;
  method: string;
  queued_at: number;
  expires_at: number;
};

/**
 * The most recent `sign` operation failure retained for host display (the
 * signing-failed dashboard condition). Mirrors
 * `bifrost_signer::OperationFailureSummary`. Present only after a sign op
 * fails; cleared by the core on the next successful sign.
 */
export type RuntimeOperationFailure = {
  request_id: string;
  /** Mirrors `PendingOpType` (serde-tagged); a sign failure carries `'Sign'`. */
  op_type: 'Sign' | 'Ecdh' | 'Ping' | 'Onboard';
  /** Mirrors `OperationFailureCode` (snake_case). */
  code: 'timeout' | 'invalid_locked_peer_response' | 'peer_rejected';
  message: string;
  failed_peer?: string | null;
  /** Unix seconds when the failure was observed. */
  failed_at: number;
};

/**
 * Most recent profile load/restore failure (the load-failed dashboard
 * condition). Mirrors `bifrost_signer::LoadErrorSummary`. Host/bridge-enriched
 * — see {@link RuntimeStatusSummary.last_load_error}.
 */
export type RuntimeLoadError = {
  message: string;
  /** Unix seconds when the load/restore failure was observed. */
  at: number;
};

/**
 * The canonical hosted read model returned by `getRuntimeStatus()` /
 * `node.runtimeStatus()`. Mirrors `bifrost_signer::RuntimeStatusSummary`
 * (bifrost-rs is the source of truth) and is the single surface UIs should
 * read for peers, readiness, permission states, and pending operations.
 * Fields carry only public/scalar data — no secret material.
 */
export type RuntimeStatusSummary = {
  status: RuntimeStatusDetails;
  metadata: RuntimeMetadata;
  readiness: RuntimeReadiness;
  peers: RuntimePeerStatus[];
  peer_permission_states: RuntimePeerPermissionState[];
  onboarding_statuses?: RuntimeOnboardingStatus[];
  pending_operations: RuntimePendingOperation[];
  pending_approvals?: RuntimePendingApproval[];
  /**
   * Most recent sign failure retained by the core (signing-failed condition).
   * Absent until a sign op fails; cleared on the next successful sign.
   */
  last_sign_failure?: RuntimeOperationFailure | null;
  /**
   * Currently-connected relay URLs. **Host/bridge-enriched** — the signer core
   * does not own relay sockets, so the core omits this and the bridge fills it
   * (browser bridge in TS; native Tokio bridge). `undefined` means "not
   * reported"; `[]` means "reported, zero connected" (drives all-relays-offline).
   */
  connected_relays?: string[] | null;
  /** Configured relay URLs (host/bridge-enriched); gives "N of M" context. */
  configured_relays?: string[] | null;
  /**
   * Most recent profile load/restore failure (load-failed condition).
   * **Host/bridge-enriched** — restore errors are returned at call time, not
   * retained by the core; the bridge layer caches and fills this.
   */
  last_load_error?: RuntimeLoadError | null;
};

export type RuntimeEvent = {
  kind:
    | 'initialized'
    | 'status_changed'
    | 'command_queued'
    | 'inbound_accepted'
    | 'config_updated'
    | 'policy_updated'
    | 'state_wiped';
  status: RuntimeStatusSummary;
};

export type GroupMemberWire = {
  idx: number;
  pubkey: string;
};

export type GroupPackageWire = {
  group_pk: string;
  threshold: number;
  members: GroupMemberWire[];
};

export type RuntimeSnapshotWire = {
  bootstrap: {
    group: GroupPackageWire;
    share: {
      idx: number;
      seckey: string;
    };
    peers: string[];
  };
  state_hex: string;
};

export type RuntimeBootstrapWire = {
  group: GroupPackageWire;
  share: {
    idx: number;
    seckey: string;
  };
  peers: string[];
  initial_peer_nonces?: Array<{
    peer: string;
    nonces: unknown[];
  }>;
};

export type ProfileBootstrapState = {
  bootstrap: RuntimeBootstrapWire;
  shareSecret: string;
};
