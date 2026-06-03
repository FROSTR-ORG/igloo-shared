/**
 * Per-event allow-list for observability payloads.
 *
 * Every `emitLog(level, domain, action, details)` call must have a matching
 * schema entry in `EVENT_SCHEMAS[domain][action]`. `sanitizeDetails` looks up
 * the allow-list for the `(domain, action)` pair and returns ONLY the fields
 * named in that list. Everything else is dropped.
 *
 * This is the inverse of the old substring-based deny-list: new bifrost-rs
 * or application fields cannot accidentally leak by failing to match a
 * forbidden-name pattern. Adding a field is a visible, reviewable code
 * change.
 *
 * Fail-closed semantics: unknown `(domain, action)` pairs return `{}`.
 *
 * All schema entries should carry only scalar fields that are either
 * public identifiers, counts, durations, or bounded enum strings. Never add:
 *
 *   - passphrases / passwords / share secrets / seckeys
 *   - raw nonces, raw ciphertexts, raw share material
 *   - `runtime_snapshot_json` (contains bootstrap.share.seckey)
 *   - `state_hex` (WASM snapshot blob)
 *   - full completion / failure / event payloads
 *
 * If a site needs to log one of these, lift the safe scalar out and emit a
 * dedicated event with a named field.
 */

type DomainName = string;
type ActionName = string;

export type EventSchema = {
  readonly [domain: DomainName]: {
    readonly [action: ActionName]: ReadonlyArray<string>;
  };
};

/**
 * Registered schemas. Adding a new event type or field here is the only way
 * to surface it in observability output.
 */
export const EVENT_SCHEMAS: EventSchema = {
  runtime: {
    detach_listener_failed: ['event_name', 'error_message'],
    wasm_runtime_init_begin: ['mode'],
    wasm_runtime_init_ok: ['mode'],
    connect_begin: ['mode', 'relay_count', 'relays'],
    restore_runtime_begin: ['mode'],
    restore_runtime_ok: ['mode'],
    init_runtime_begin: ['mode'],
    init_runtime_ok: ['mode'],
    profile_bootstrap_nonces_seeded: ['peer_pubkey32', 'nonce_count'],
    profile_bootstrap_nonces_empty: ['peer_pubkey32'],
    profile_bootstrap_nonces_failed: ['peer_pubkey32', 'error_message'],
    startup_peer_refresh_queued: ['peer_count', 'peers'],
    startup_peer_refresh_failed: ['error_message'],
    bootstrap_complete: ['relays', 'peers', 'public_key', 'event_kind'],
    bootstrap_peer_refresh_complete: ['peers_total', 'peers_ok'],
    prepare_complete: [
      'operation',
      'proceeded_while_degraded',
      'freshness_satisfied',
      'last_refresh_at',
      'threshold',
      'signing_peer_count',
      'ecdh_peer_count',
    ],
    prepare_refresh_begin: ['operation'],
    restore_skipped: ['reason'],
    restored: ['mode', 'peers', 'public_key'],
    restore_failed: ['error_message'],
    inbound_error: ['error_message'],
    status_event: ['kind', 'sign_ready', 'ecdh_ready', 'pending_ops'],
    completion: [
      'request_id',
      'kind',
      'op_status',
      'elapsed_ms',
      // Kept explicit even though `kind` covers it: preserves the
      // original observability signal that surfaced the completion.
      'peer',
    ],
    stale_completion: ['request_id', 'kind'],
    failure: [
      'request_id',
      'kind',
      'reason_code',
      'elapsed_ms',
      'op_type',
      'message',
    ],
    pump_failed: ['error_message'],
  },
  relay: {
    probe_start: ['relay'],
    probe_ok: ['relay'],
    probe_failed: ['relay', 'error_message'],
    connected: ['relay'],
    connect_failed: ['relay', 'error_message'],
    bootstrap_begin: ['relay_count', 'relays'],
    bootstrap_ok: ['connected_relays'],
    inbound_event: ['event_id', 'event_pubkey', 'event_created_at', 'event_kind'],
    subscription_closed: ['reasons'],
    publish_complete: ['event_id', 'relays_ok', 'relays_total'],
  },
  onboarding: {
    package_decoded: ['mode', 'share_pubkey32', 'peer_pubkey32', 'relay_count'],
    response_received: ['peer_pubkey32', 'nonce_count', 'group_member_count'],
    request_start: [
      'request_id',
      'peer_pubkey32',
      'share_pubkey32',
      'nonce_count',
      'relays',
    ],
    request_timeout: [
      'request_id',
      'peer_pubkey32',
      'share_pubkey32',
      'relays',
      'close_reasons',
    ],
    response_event_received: ['request_id', 'event_id', 'author', 'tag_p'],
    request_complete: ['request_id', 'peer_pubkey32', 'share_pubkey32'],
    response_event_ignored: ['request_id', 'event_id', 'reason'],
    request_closed: ['request_id', 'reasons', 'relays'],
    request_publish: ['request_id', 'relays_ok', 'relays_total'],
    decrypt_cap_reached: ['request_id'],
    peer_not_in_group: ['request_id'],
    duplicate_members: ['request_id'],
    bad_threshold: ['request_id'],
  },
  bridge: {
    command_start: ['command_kind'],
    command_timeout: ['command_kind'],
    command_failed: ['command_kind', 'error_message'],
  },
  wasm: {
    loader_init: ['source'],
  },
  ui: {
    refresh_peers_failed: ['error_message'],
  },
  profile: {
    activate_runtime_unavailable: [
      'stage',
      'warning_code',
      'warning_message',
      'warning_detail',
    ],
    activate_failed: ['stage', 'error_message'],
    persist_failed: ['flow_kind', 'stage', 'profile_id', 'error_message'],
    decode_failed: ['flow_kind', 'stage', 'profile_id', 'error_message'],
    finalize_failed: ['flow_kind', 'stage', 'profile_id', 'error_message'],
    reconstruct_failed: ['flow_kind', 'stage', 'profile_id', 'error_message'],
  },
};

/**
 * Return a new object containing only the fields allowed for the given
 * `(domain, action)` pair. Unknown domains or actions yield `{}`.
 *
 * This function performs shallow field-name matching; it does not recurse
 * into nested objects or arrays. Callers that want to log structured
 * sub-payloads must flatten the safe scalars into named top-level fields
 * before emitting.
 */
export function sanitizeDetails(
  domain: string,
  action: string,
  details?: Record<string, unknown>,
): Record<string, unknown> {
  if (!details) return {};
  const allowed = EVENT_SCHEMAS[domain]?.[action];
  if (!allowed) {
    // Fail closed. Unknown event = empty payload.
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in details) {
      out[key] = details[key];
    }
  }
  return out;
}

/**
 * True when a schema entry exists for `(domain, action)`. Useful for
 * CI-style assertions in tests that want to verify every call site has a
 * matching registration.
 */
export function hasEventSchema(domain: string, action: string): boolean {
  return Boolean(EVENT_SCHEMAS[domain]?.[action]);
}
