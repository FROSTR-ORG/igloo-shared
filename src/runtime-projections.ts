/**
 * Typed projection-selector helpers over `RuntimeStatusSummary`.
 *
 * Pure, side-effect-free selectors so hosts (pwa/home/chrome) can stop
 * hand-rolling field access against the runtime status wire shape. Each
 * selector reads only from its argument and returns a derived view; no I/O,
 * no mutation, no runtime/value imports beyond the readiness derivation that
 * already lives in `./runtime-api`.
 *
 * Added in PR32 (Bucket G.4, igloo-shared side only). Consumer migration is a
 * separate later phase — nothing here changes existing host behavior.
 */

import { deriveReadinessExplanation } from './runtime-api';

import type {
  RuntimeOnboardingStatus,
  RuntimePeerPermissionState,
  RuntimePeerStatus,
  RuntimePendingOperation,
  RuntimeReadinessExplanation,
  RuntimeStatusSummary,
} from './wire';

/**
 * Peers that are both online and known (i.e. actively reachable members we
 * have identified). Uses the real `RuntimePeerStatus` fields `online` and
 * `known`.
 */
export function selectActivePeers(status: RuntimeStatusSummary): RuntimePeerStatus[] {
  return status.peers.filter((peer) => peer.online && peer.known);
}

/** All pending operations the runtime is currently tracking. */
export function selectPendingOperations(
  status: RuntimeStatusSummary
): RuntimePendingOperation[] {
  return status.pending_operations;
}

/** Per-peer permission state (manual overrides, remote observation, effective policy). */
export function selectPeerPermissionStates(
  status: RuntimeStatusSummary
): RuntimePeerPermissionState[] {
  return status.peer_permission_states;
}

/**
 * Onboarding statuses. `onboarding_statuses` is optional on the wire shape,
 * so default to an empty array when absent.
 */
export function selectOnboardingStatuses(
  status: RuntimeStatusSummary
): RuntimeOnboardingStatus[] {
  return status.onboarding_statuses ?? [];
}

/**
 * Readiness explanation. Thin wrapper over the existing
 * `deriveReadinessExplanation` derivation — not reimplemented here.
 */
export function selectReadinessExplanation(
  status: RuntimeStatusSummary
): RuntimeReadinessExplanation {
  return deriveReadinessExplanation(status);
}

/** Count of online peers. */
export function countOnlinePeers(status: RuntimeStatusSummary): number {
  return status.peers.filter((peer) => peer.online).length;
}

/** Count of known peers. */
export function countKnownPeers(status: RuntimeStatusSummary): number {
  return status.peers.filter((peer) => peer.known).length;
}

/** Whether any pending operation is a signing operation. */
export function hasPendingSigns(status: RuntimeStatusSummary): boolean {
  return status.pending_operations.some((op) => op.op_type === 'sign');
}

/**
 * Configured nonce-pool max capacity, if the runtime status exposes one.
 *
 * The current `RuntimeStatusSummary`/`RuntimePeerStatus`/`RuntimeMetadata`
 * wire shapes do NOT carry a configured nonce-pool capacity: peers only
 * report live `incoming_available` / `outgoing_available` / `outgoing_spent`
 * counts, not the pool's configured maximum. We deliberately do not invent a
 * field that is absent from the wire type, so this returns `undefined` and
 * hosts fall back to the NonceBar default. If/when bifrost-rs adds a
 * capacity/max field to the status summary, wire it up here.
 */
export function selectNoncePoolCapacity(
  _status: RuntimeStatusSummary
): number | undefined {
  return undefined;
}
