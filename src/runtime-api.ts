// Public runtime API — the free functions that operate on a BrowserBridgeNode.
//
// PR30: extracted verbatim from `browser-runtime-core.ts`. This module owns
// the operator-facing free functions and re-exports the BrowserBridgeNode
// class, the wire types, and the topical helper symbols so the package
// barrel surface (`src/index.ts`) is unchanged.

import { getPublicKey, type Event } from 'nostr-tools';

import { decodeBfOnboardPackage } from './profile-package';
import {
  logger,
  isRecord,
  toErrorMessage,
  hexToBytes
} from './runtime-internal';
import { normalizeRelays, DEFAULT_RELAYS } from './relay-transport';
import type { SignerSettings } from './signer-settings';
import {
  BrowserBridgeNode,
  type PeerPolicy,
  type PingResult,
  type ValidationResult
} from './wasm-bridge-node';
import type { PeerPolicyOverridePatch } from './onboarding-transport';
import type {
  DecodedOnboardingProfile,
  RuntimeConfig,
  RuntimeMetadata,
  RuntimePeerPermissionState,
  RuntimePeerStatus,
  RuntimeReadiness,
  RuntimeReadinessExplanation,
  RuntimeRestoreOptions,
  RuntimeStatusSummary
} from './wire';

// --- Re-exports so the package barrel surface stays unchanged ---
export { BrowserBridgeNode } from './wasm-bridge-node';
export type { PeerPolicy, PingResult, ValidationResult } from './wasm-bridge-node';
export { DEFAULT_RELAYS, normalizeRelays } from './relay-transport';
export {
  MAX_ONBOARDING_DECRYPTS,
  createOnboardingDecryptCounter,
  recordOnboardingDecryptAttempt,
  validateOnboardingGroup
} from './onboarding-transport';
export type {
  OnboardingDecryptCounter,
  OnboardingGroupValidation
} from './onboarding-transport';
export {
  createPendingBridgeCommandState,
  matchBridgeCompletion
} from './runtime-pump';
export type {
  BridgeDispatchOutcome,
  PendingBridgeCommand,
  PendingBridgeCommandKind,
  PendingBridgeCommandState
} from './runtime-pump';

export function deriveReadinessExplanation(
  runtimeStatus: RuntimeStatusSummary
): RuntimeReadinessExplanation {
  const { readiness, peers } = runtimeStatus;
  const signInitiatorPeers = peers.filter((peer) => peer.can_sign).map((peer) => peer.pubkey);
  const signResponderPeers = peers
    .filter((peer) => peer.online && peer.outgoing_available > 0)
    .map((peer) => peer.pubkey);
  const ecdhReadyPeers = peers.filter((peer) => peer.online).map((peer) => peer.pubkey);

  return {
    runtime_ready: readiness.runtime_ready,
    restore_complete: readiness.restore_complete,
    sign_ready: readiness.sign_ready,
    ecdh_ready: readiness.ecdh_ready,
    threshold: readiness.threshold,
    signing_peer_count: readiness.signing_peer_count,
    ecdh_peer_count: readiness.ecdh_peer_count,
    last_refresh_at: readiness.last_refresh_at,
    degraded_reasons: readiness.degraded_reasons,
    operations: {
      sign_initiator_ready: readiness.sign_ready,
      sign_responder_ready: signResponderPeers.length >= readiness.threshold,
      ecdh_ready: readiness.ecdh_ready,
      sign_initiator_peer_count: signInitiatorPeers.length,
      sign_responder_peer_count: signResponderPeers.length,
      ecdh_peer_count: ecdhReadyPeers.length,
      sign_initiator_peers: signInitiatorPeers,
      sign_responder_peers: signResponderPeers,
      ecdh_ready_peers: ecdhReadyPeers,
      missing_sign_initiator_peers: peers
        .filter((peer) => !peer.can_sign)
        .map((peer) => peer.pubkey),
      missing_sign_responder_peers: peers
        .filter((peer) => !(peer.online && peer.outgoing_available > 0))
        .map((peer) => peer.pubkey),
      missing_ecdh_peers: peers.filter((peer) => !peer.online).map((peer) => peer.pubkey)
    }
  };
}

export function validateOnboardingPassword(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return { isValid: false, error: 'Password is required' };
  }
  if (trimmed.length < 8) {
    return { isValid: false, error: 'Password must be at least 8 characters' };
  }
  return { isValid: true };
}

export async function decodeOnboardingProfile(
  value: string,
  password: string
): Promise<DecodedOnboardingProfile> {
  const decoded = await decodeBfOnboardPackage(value.trim(), password);
  const shareSecret = decoded.shareSecret;
  const publicKey =
    typeof shareSecret === 'string' ? getPublicKey(hexToBytes(shareSecret)).toLowerCase() : null;
  const peerPubkey = decoded.peerPubkey;
  const relays = decoded.relays;

  if (typeof publicKey !== 'string' || publicKey.length !== 64) {
    throw new Error('Decoded onboarding payload is missing a valid share pubkey');
  }

  if (typeof peerPubkey !== 'string' || peerPubkey.length !== 64) {
    throw new Error('Decoded onboarding payload is missing a valid peer pubkey');
  }

  return {
    publicKey: publicKey.toLowerCase(),
    peerPubkey: peerPubkey.toLowerCase(),
    relays: Array.isArray(relays)
      ? relays.filter((relay): relay is string => typeof relay === 'string')
      : []
  };
}

export function validateOnboardCredential(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return { isValid: false, error: 'Onboarding package is required' };
  }

  if (!trimmed.startsWith('bfonboard1')) {
    return { isValid: false, error: 'Onboarding package must start with bfonboard1' };
  }

  if (!/^bfonboard1[023456789acdefghjklmnpqrstuvwxyz]+$/.test(trimmed)) {
    return { isValid: false, error: 'Onboarding package must be valid bech32m text' };
  }

  if (trimmed.length < 48) {
    return { isValid: false, error: 'Onboarding package is too short' };
  }

  return { isValid: true };
}

export function createSignerNode(
  config: RuntimeConfig,
  restoreOptions?: RuntimeRestoreOptions
): BrowserBridgeNode {
  return new BrowserBridgeNode(config, restoreOptions);
}

export async function connectSignerNode(node: BrowserBridgeNode) {
  await node.connect();
}

export async function startSignerNode(config: RuntimeConfig): Promise<BrowserBridgeNode> {
  const node = createSignerNode(config);
  await connectSignerNode(node);
  return node;
}

export function stopSignerNode(node: BrowserBridgeNode | null) {
  if (!node) return;
  void node.shutdown();
}

export async function refreshPeerStatuses(
  node: BrowserBridgeNode,
  peers: PeerPolicy[]
): Promise<PeerPolicy[]> {
  try {
    return await node.fetchPeers(peers);
  } catch (error) {
    logger.warn('ui', 'refresh_peers_failed', {
      error_message: toErrorMessage(error, 'failed to refresh peer status')
    });
    return peers;
  }
}

export async function pingSinglePeer(node: BrowserBridgeNode, pubkey: string): Promise<PingResult> {
  try {
    return await node.pingPeer(pubkey);
  } catch (error) {
    return {
      success: false,
      error: toErrorMessage(error, 'Ping failed')
    };
  }
}

export function detachEvent(
  node: BrowserBridgeNode,
  event: string,
  handler: (...args: unknown[]) => void
) {
  try {
    node.off(event, handler);
  } catch (error) {
    logger.warn('runtime', 'detach_listener_failed', {
      event_name: event,
      error_message: toErrorMessage(error, `Failed to detach event ${event}`)
    });
  }
}

export async function signNostrEvent(
  node: BrowserBridgeNode,
  event: Record<string, unknown>
): Promise<Event> {
  return await node.signNostrEvent(event);
}

export function getPublicKeyFromNode(node: BrowserBridgeNode): string {
  return node.getPublicKey();
}

export function getSharePublicKeyFromNode(node: BrowserBridgeNode): string {
  return node.getSharePublicKey();
}

export function getRuntimeConfigFromNode(node: BrowserBridgeNode): SignerSettings {
  return node.readConfig();
}

export function getRuntimePeerPermissionStatesFromNode(
  node: BrowserBridgeNode
): RuntimePeerPermissionState[] {
  const states = JSON.parse(node.peerPermissionStates()) as RuntimePeerPermissionState[];
  return Array.isArray(states)
    ? [...states].sort((a, b) => a.pubkey.localeCompare(b.pubkey))
    : [];
}

export async function updateRuntimePeerPolicyOverrideOnNode(
  node: BrowserBridgeNode,
  pubkey: string,
  patch: PeerPolicyOverridePatch
) {
  await node.updatePeerPolicyOverride(pubkey, patch);
}

export async function clearRuntimePeerPolicyOverridesOnNode(node: BrowserBridgeNode) {
  await node.clearPeerPolicyOverrides();
}

export function updateRuntimeConfigOnNode(
  node: BrowserBridgeNode,
  settings: Partial<SignerSettings>
): void {
  node.updateConfig(settings);
}

export function getRuntimeMetadata(node: BrowserBridgeNode): RuntimeMetadata {
  return node.runtimeMetadata();
}

export function getRuntimePeerStatus(node: BrowserBridgeNode): RuntimePeerStatus[] {
  return node.runtimePeerStatus();
}

export function getRuntimeReadiness(node: BrowserBridgeNode): RuntimeReadiness {
  return node.runtimeReadiness();
}

export function refreshAllPeersOnNode(node: BrowserBridgeNode): void {
  node.refreshAllPeers();
}

export function wipeRuntimeStateOnNode(node: BrowserBridgeNode): void {
  node.wipeState();
}

export async function prepareSignOnNode(node: BrowserBridgeNode): Promise<RuntimeReadiness> {
  return await node.prepareSign();
}

export async function prepareEcdhOnNode(node: BrowserBridgeNode): Promise<RuntimeReadiness> {
  return await node.prepareEcdh();
}

export async function nip44EncryptWithNode(
  node: BrowserBridgeNode,
  pubkey: string,
  plaintext: string
): Promise<string> {
  return await node.nip44Encrypt(pubkey, plaintext);
}

export async function nip44DecryptWithNode(
  node: BrowserBridgeNode,
  pubkey: string,
  ciphertext: string
): Promise<string> {
  return await node.nip44Decrypt(pubkey, ciphertext);
}

export function getRuntimeSnapshot(node: BrowserBridgeNode): unknown {
  return node.snapshotRuntimeState();
}

export function getRuntimeStatus(node: BrowserBridgeNode): RuntimeStatusSummary {
  return node.runtimeStatus();
}
