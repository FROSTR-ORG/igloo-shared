import { SimplePool, getPublicKey, nip44, type Event, type Filter } from 'nostr-tools';
import { getEventHash, validateEvent, verifyEvent } from 'nostr-tools/pure';

import {
  createWasmBridgeRuntime,
  getWasmBridgeOnboardingApi,
  type WasmBridgeRuntimeApi
} from './bridge-wasm-runtime';
import { decodeBfOnboardPackage } from './profile-package';
import { createLogger } from './observability';
import {
  normalizeNip44PayloadForJs,
  normalizeNip44PayloadForRust
} from './nip44-normalize';
import {
  normalizeSignerSettings,
  type SignerSettings
} from './signer-settings';

const DEFAULT_RELAYS_FALLBACK = ['ws://127.0.0.1:8194'];
const BROWSER_RUNTIME_ENV = ((import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env ?? {});

function envDefaultRelays(): string[] {
  const raw = BROWSER_RUNTIME_ENV.VITE_DEFAULT_RELAYS;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return DEFAULT_RELAYS_FALLBACK;
  }
  const parsed = raw
    .split(/[,\s]+/)
    .map((relay) => relay.trim())
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_RELAYS_FALLBACK;
}

export const DEFAULT_RELAYS = envDefaultRelays();

const BIFROST_EVENT_KIND_RAW = Number(BROWSER_RUNTIME_ENV.VITE_BIFROST_EVENT_KIND ?? 20000);
const BIFROST_EVENT_KIND = Number.isFinite(BIFROST_EVENT_KIND_RAW)
  ? BIFROST_EVENT_KIND_RAW
  : 20000;
const ONBOARD_TIMEOUT_MS = 10_000;
const PING_TIMEOUT_MS = 10_000;
const BRIDGE_COMMAND_TIMEOUT_MS = 10_000;
const PREPARE_OPERATION_TIMEOUT_MS = 10_000;
const WASM_RUNTIME_INIT_TIMEOUT_MS = 10_000;
const RELAY_CONNECT_TIMEOUT_MS = 10_000;
const RECOVERED_PENDING_OPS_REASON = 'pending_operations_recovered';
const INSUFFICIENT_SIGNING_PEERS_REASON = 'insufficient_signing_peers';
const INSUFFICIENT_ECDH_PEERS_REASON = 'insufficient_ecdh_peers';
const logger = createLogger('igloo.runtime');

type RuntimeConfig = {
  mode: 'onboarding' | 'persisted' | 'profile';
  relays: string[];
  signerSettings?: Partial<SignerSettings>;
  onboardPackage?: string;
  onboardPassword?: string;
  bootstrapPeerPubkey32Hex?: string;
  runtimeSnapshotJson?: string | null;
  groupPackageJson?: string;
  sharePackageJson?: string;
};

type RuntimeRestoreOptions = {
  runtimeSnapshotJson?: string | null;
};

type OnboardingDecoded = {
  share_secret: string;
  share_pubkey32: string;
  peer_pk_xonly: string;
  relays: string[];
};

type OnboardingRequestBundleWire = {
  request_id: string;
  local_pubkey32: string;
  request_nonces: unknown[];
  bootstrap_state_hex: string;
  event_json: string;
};

type OnboardingRequestResult = {
  response: OnboardResponseWire;
  bundle: OnboardingRequestBundleWire;
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}

function canProceedWhileDegraded(kind: 'sign' | 'ecdh', degradedReasons: string[]) {
  if (degradedReasons.length === 0) {
    return false;
  }

  const allowedReasons =
    kind === 'sign'
      ? new Set([RECOVERED_PENDING_OPS_REASON, INSUFFICIENT_ECDH_PEERS_REASON])
      : new Set([RECOVERED_PENDING_OPS_REASON, INSUFFICIENT_SIGNING_PEERS_REASON]);

  return degradedReasons.every((reason) => allowedReasons.has(reason));
}

export type DecodedOnboardingProfile = {
  publicKey: string;
  peerPubkey: string;
  relays: string[];
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
  should_send_nonces: boolean;
};

export type RuntimeMetadata = {
  device_id: string;
  member_idx: number;
  share_public_key: string;
  group_public_key: string;
  peers: string[];
};

export type PolicyOverrideValue = 'unset' | 'allow' | 'deny';

export type RuntimeMethodPolicy = {
  ping: boolean;
  onboard: boolean;
  sign: boolean;
  ecdh: boolean;
};

export type RuntimeMethodPolicyOverride = {
  ping: PolicyOverrideValue;
  onboard: PolicyOverrideValue;
  sign: PolicyOverrideValue;
  ecdh: PolicyOverrideValue;
};

export type RuntimePeerPermissionState = {
  pubkey: string;
  manual_override: {
    request: RuntimeMethodPolicyOverride;
    respond: RuntimeMethodPolicyOverride;
  };
  remote_observation: {
    request: RuntimeMethodPolicy;
    respond: RuntimeMethodPolicy;
    updated: number;
    revision: number;
  } | null;
  effective_policy: {
    request: RuntimeMethodPolicy;
    respond: RuntimeMethodPolicy;
  };
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

export type RuntimeStatusSummary = {
  status: RuntimeStatusDetails;
  metadata: RuntimeMetadata;
  readiness: RuntimeReadiness;
  peers: RuntimePeerStatus[];
  peer_permission_states: RuntimePeerPermissionState[];
  onboarding_statuses?: RuntimeOnboardingStatus[];
  pending_operations: RuntimePendingOperation[];
};

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

type GroupMemberWire = {
  idx: number;
  pubkey: string;
};

type GroupPackageWire = {
  group_pk: string;
  threshold: number;
  members: GroupMemberWire[];
};

type RuntimeSnapshotWire = {
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

type RuntimeBootstrapWire = {
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

type ProfileBootstrapState = {
  bootstrap: RuntimeBootstrapWire;
  shareSecret: string;
};

type OnboardResponseWire = {
  group: GroupPackageWire;
  nonces: unknown[];
};

type BridgeEnvelope = {
  request_id: string;
  sent_at: number;
  payload: {
    type: string;
    data: unknown;
  };
};

export type ValidationResult = {
  isValid: boolean;
  error?: string;
};

export type PingResult = {
  success: boolean;
  latency?: number;
  error?: string;
};

export type PeerPolicy = {
  pubkey: string;
  send: boolean;
  receive: boolean;
  [key: string]: unknown;
};

export type NodeWithEvents = {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

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

type PeerPolicyOverridePatch = {
  direction: 'request' | 'respond';
  method: 'ping' | 'onboard' | 'sign' | 'ecdh';
  value: PolicyOverrideValue;
};

type PendingPing = {
  peer: string;
  startedAtMs: number;
  quiet: boolean;
  resolve: (value: PingResult) => void;
};

type PendingBridgeCommandKind = 'sign' | 'ecdh';

type PendingBridgeCommand = {
  kind: PendingBridgeCommandKind;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
};

const ensureArray = (value: string[]) =>
  Array.from(new Set(value.map((relay) => relay.replace(/\/$/, ''))));

function nowUnixSecs(): number {
  return Math.floor(Date.now() / 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toErrorMessage(value: unknown, fallback = 'Request failed'): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (value instanceof Error && value.message) return value.message;
  if (isRecord(value)) {
    const message = value.message;
    if (typeof message === 'string' && message.trim()) return message;
    const error = value.error;
    if (typeof error === 'string' && error.trim()) return error;
    const reason = value.reason;
    if (typeof reason === 'string' && reason.trim()) return reason;
  }
  return fallback;
}

function withContext(step: string, error: unknown): Error {
  return new Error(`${step}: ${toErrorMessage(error, 'unknown error')}`);
}

function isRelayUrl(value: string): boolean {
  return /^wss?:\/\/.+/.test(value);
}

function normalizePubkey32Hex(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(normalized)) {
    return normalized;
  }
  if (/^(02|03)[0-9a-f]{64}$/.test(normalized)) {
    return normalized.slice(2);
  }
  throw new Error(`Invalid ${label}`);
}

function normalizeHex32(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

function hexToBytes(value: string): Uint8Array {
  const hex = value.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error('Invalid hex payload');
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function parseBridgeEnvelope(value: string): BridgeEnvelope | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return null;
    if (typeof parsed.request_id !== 'string') return null;
    if (!isRecord(parsed.payload)) return null;
    if (typeof parsed.payload.type !== 'string') return null;
    return {
      request_id: parsed.request_id,
      sent_at: Number(parsed.sent_at ?? 0),
      payload: {
        type: parsed.payload.type,
        data: parsed.payload.data
      }
    };
  } catch {
    return null;
  }
}

function parseOnboardingRequestBundle(value: string): OnboardingRequestBundleWire {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Invalid onboarding request bundle');
  }
  if (typeof parsed.request_id !== 'string' || !parsed.request_id.trim()) {
    throw new Error('Invalid onboarding request id');
  }
  if (typeof parsed.local_pubkey32 !== 'string' || !parsed.local_pubkey32.trim()) {
    throw new Error('Invalid onboarding local pubkey');
  }
  if (!Array.isArray(parsed.request_nonces)) {
    throw new Error('Invalid onboarding request nonces');
  }
  if (typeof parsed.bootstrap_state_hex !== 'string' || !parsed.bootstrap_state_hex.trim()) {
    throw new Error('Invalid onboarding bootstrap state');
  }
  if (typeof parsed.event_json !== 'string' || !parsed.event_json.trim()) {
    throw new Error('Invalid onboarding request event');
  }
  return parsed as OnboardingRequestBundleWire;
}

function parseEventJson(value: string, context: string): Event {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Invalid ${context}`);
  }
  return parsed as Event;
}

function allPolicyFlagsEnabled(value: unknown): boolean {
  if (!isRecord(value)) return true;
  const flags = ['echo', 'ping', 'onboard', 'sign', 'ecdh'];
  return flags.every((key) => value[key] !== false);
}

function parsePingCompletion(completion: unknown): { requestId: string; peer: string } | null {
  if (!isRecord(completion)) return null;
  const payload = completion.Ping;
  if (!isRecord(payload)) return null;

  const requestId = payload.request_id;
  const peer = payload.peer;
  if (typeof requestId !== 'string' || typeof peer !== 'string') return null;
  return { requestId, peer };
}

function parseSignCompletion(completion: unknown): { signatures: string[] } | null {
  if (!isRecord(completion)) return null;
  const payload = completion.Sign;
  if (!isRecord(payload) || !Array.isArray(payload.signatures_hex64)) return null;
  const signatures = payload.signatures_hex64.filter(
    (value): value is string => typeof value === 'string'
  );
  return signatures.length > 0 ? { signatures } : null;
}

function parseEcdhCompletion(completion: unknown): { sharedSecretHex32: string } | null {
  if (!isRecord(completion)) return null;
  const payload = completion.Ecdh;
  if (!isRecord(payload) || typeof payload.shared_secret_hex32 !== 'string') return null;
  return { sharedSecretHex32: payload.shared_secret_hex32.toLowerCase() };
}

function parseOperationFailure(
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
function completionKind(completion: unknown): string {
  if (!isRecord(completion)) return 'unknown';
  if (isRecord(completion.Ping)) return 'ping';
  if (isRecord(completion.Sign)) return 'sign';
  if (isRecord(completion.Ecdh)) return 'ecdh';
  return 'unknown';
}

/** Extract `request_id` from a completion payload, or return `undefined`. */
function completionRequestId(completion: unknown): string | undefined {
  if (!isRecord(completion)) return undefined;
  for (const payload of [completion.Ping, completion.Sign, completion.Ecdh]) {
    if (isRecord(payload) && typeof payload.request_id === 'string') {
      return payload.request_id;
    }
  }
  return undefined;
}

/** Extract `request_id` from a failure payload, or return `undefined`. */
function failureRequestId(failure: unknown): string | undefined {
  if (!isRecord(failure)) return undefined;
  return typeof failure.request_id === 'string' ? failure.request_id : undefined;
}

function clearPendingCommand(pending: PendingBridgeCommand | null) {
  if (!pending) return;
  clearTimeout(pending.timeoutHandle);
}

async function deriveConversationKeyFromSharedSecret(sharedSecretHex32: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('nip44-v2'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sharedSecretBytes = new Uint8Array(hexToBytes(sharedSecretHex32));
  const digest = await crypto.subtle.sign('HMAC', key, sharedSecretBytes);
  return new Uint8Array(digest);
}

function buildUnsignedEvent(event: Record<string, unknown>, pubkey: string) {
  const candidate = {
    kind: event.kind,
    tags: event.tags ?? [],
    content: event.content ?? '',
    created_at:
      typeof event.created_at === 'number' ? event.created_at : Math.floor(Date.now() / 1000),
    pubkey
  };

  if (!validateEvent(candidate)) {
    throw new Error('Event failed validation');
  }

  return candidate;
}

class BrowserBridgeNode implements NodeWithEvents {
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  private pool: SimplePool | null = null;
  private relaySubscription: { close: (reason?: string) => void } | null = null;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private runtime: WasmBridgeRuntimeApi | null = null;

  private activeRelays: string[] = [];
  private localSharePubkey32 = '';
  private groupPubkey32 = '';
  private peerPubkeys32 = new Set<string>();
  private xonlyToPeer32 = new Map<string, string>();
  private pendingPings: PendingPing[] = [];
  private pendingCommand: PendingBridgeCommand | null = null;
  private commandChain: Promise<void> = Promise.resolve();
  private lastRuntimeStatus: RuntimeStatusSummary | null = null;
  private readonly nodeLogger = logger;
  private connectedRelays = new Set<string>();
  private relayConnectionFailures = new Map<string, string>();

  constructor(
    private readonly config: RuntimeConfig,
    private readonly restoreOptions: RuntimeRestoreOptions = {}
  ) {}

  on(event: string, handler: (...args: unknown[]) => void) {
    const set = this.handlers.get(event) || new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }

  off(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.get(event)?.delete(handler);
  }

  removeListener(event: string, handler: (...args: unknown[]) => void) {
    this.off(event, handler);
  }

  private emit(event: string, ...args: unknown[]) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      handler(...args);
    }
  }

  private emitLog(
    level: 'debug' | 'info' | 'warn' | 'error',
    domain: string,
    event: string,
    detail?: Record<string, unknown>
  ) {
    const nextEvent = this.nodeLogger[level](domain, event, detail);
    if (nextEvent) {
      this.emit('message', nextEvent);
    }
  }

  private async probeRelayWebSocket(relay: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (typeof WebSocket === 'undefined') {
        reject(new Error('WebSocket unavailable in this runtime'));
        return;
      }

      let settled = false;
      let socket: WebSocket | null = null;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      const timeoutHandle = setTimeout(() => {
        finish(() => {
          try {
            socket?.close();
          } catch {
            // ignore close errors during probe timeout
          }
          reject(new Error(`WebSocket connect timeout (${relay})`));
        });
      }, 3_000);

      try {
        socket = new WebSocket(relay);
      } catch (error) {
        clearTimeout(timeoutHandle);
        finish(() => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
        return;
      }

      socket.onopen = () => {
        clearTimeout(timeoutHandle);
        finish(() => {
          try {
            socket?.close();
          } catch {
            // ignore close errors after successful probe
          }
          resolve();
        });
      };
      socket.onerror = () => {
        clearTimeout(timeoutHandle);
        finish(() => {
          reject(new Error(`WebSocket connect error (${relay})`));
        });
      };
      socket.onclose = (event) => {
        if (settled) return;
        clearTimeout(timeoutHandle);
        finish(() => {
          reject(
            new Error(
              `WebSocket closed during connect (${relay}, code=${event.code}, reason=${event.reason || 'none'})`
            )
          );
        });
      };
    });
  }

  private async connectActiveRelays() {
    if (!this.pool) throw new Error('relay pool not initialized');

    this.connectedRelays.clear();
    this.relayConnectionFailures.clear();

    for (const relay of this.activeRelays) {
      try {
        this.emitLog('debug', 'relay', 'probe_start', { relay });
        await this.probeRelayWebSocket(relay);
        this.emitLog('debug', 'relay', 'probe_ok', { relay });
      } catch (error) {
        const message = toErrorMessage(error, 'relay websocket probe failed');
        this.relayConnectionFailures.set(relay, message);
        this.emitLog('warn', 'relay', 'probe_failed', {
          relay,
          error_message: message
        });
        continue;
      }

      try {
        await this.pool.ensureRelay(relay, { connectionTimeout: 3_000 });
        this.connectedRelays.add(relay);
        this.emitLog('info', 'relay', 'connected', { relay });
      } catch (error) {
        const message = toErrorMessage(error, 'relay connection failed');
        this.relayConnectionFailures.set(relay, message);
        this.emitLog('warn', 'relay', 'connect_failed', {
          relay,
          error_message: message
        });
      }
    }

    if (this.connectedRelays.size === 0) {
      const reasons = Array.from(this.relayConnectionFailures.entries()).map(
        ([relay, reason]) => `${relay}: ${reason}`
      );
      throw new Error(`No connected relays available (${reasons.join('; ')})`);
    }
  }

  private relayTargets(): string[] {
    return this.connectedRelays.size > 0 ? Array.from(this.connectedRelays) : this.activeRelays;
  }

  async connect() {
    try {
      this.emitLog('info', 'runtime', 'wasm_runtime_init_begin', {
        mode: this.config.mode
      });
      this.runtime = await withTimeout(
        createWasmBridgeRuntime(),
        WASM_RUNTIME_INIT_TIMEOUT_MS,
        'WASM bridge runtime initialization'
      );
      this.emitLog('info', 'runtime', 'wasm_runtime_init_ok', {
        mode: this.config.mode
      });
    } catch (error) {
      throw withContext('Failed to load WASM runtime', error);
    }

    let decoded: OnboardingDecoded | null = null;
    if (this.config.mode === 'onboarding') {
      try {
        decoded = await this.decodeOnboardingPackage(
          this.config.onboardPackage ?? '',
          this.config.onboardPassword ?? ''
        );
      } catch (error) {
        throw withContext('Failed to decode onboarding package', error);
      }
      this.localSharePubkey32 = decoded.share_pubkey32.toLowerCase();
      this.emitLog('info', 'onboarding', 'package_decoded', {
        mode: this.config.mode,
        share_pubkey32: decoded.share_pubkey32.toLowerCase(),
        peer_pubkey32: decoded.peer_pk_xonly.toLowerCase(),
        relay_count: decoded.relays.length
      });
    }

    const mergedRelays = normalizeRelays([
      ...this.config.relays,
      ...(decoded?.relays ?? [])
    ]);
    this.activeRelays = mergedRelays.relays;
    this.emitLog('info', 'runtime', 'connect_begin', {
      mode: this.config.mode,
      relay_count: this.activeRelays.length,
      relays: this.activeRelays
    });

    this.pool = new SimplePool({ enableReconnect: true } as never);

    const signerSettings = normalizeSignerSettings(this.config.signerSettings);
    const runtimeConfig = {
      device: {
        sign_timeout_secs: signerSettings.sign_timeout_secs,
        ecdh_timeout_secs: 30,
        ping_timeout_secs: signerSettings.ping_timeout_secs,
        onboard_timeout_secs: 30,
        request_ttl_secs: signerSettings.request_ttl_secs,
        max_future_skew_secs: 30,
        request_cache_limit: 2048,
        ecdh_cache_capacity: 256,
        ecdh_cache_ttl_secs: 300,
        sig_cache_capacity: 256,
        sig_cache_ttl_secs: 120,
        state_save_interval_secs: signerSettings.state_save_interval_secs,
        event_kind: BIFROST_EVENT_KIND,
        peer_selection_strategy: signerSettings.peer_selection_strategy
      }
    };

    this.emitLog('info', 'relay', 'bootstrap_begin', {
      relay_count: this.activeRelays.length,
      relays: this.activeRelays
    });
    await withTimeout(this.connectActiveRelays(), RELAY_CONNECT_TIMEOUT_MS, 'Relay connection bootstrap');
    this.emitLog('info', 'relay', 'bootstrap_ok', {
      connected_relays: Array.from(this.connectedRelays)
    });

    if (this.config.mode === 'persisted') {
      this.emitLog('info', 'runtime', 'restore_runtime_begin', {
        mode: 'persisted'
      });
      const restored = this.tryRestoreRuntime(runtimeConfig);
      if (!restored) {
        throw new Error('Failed to restore runtime snapshot');
      }
      this.emitLog('info', 'runtime', 'restore_runtime_ok', {
        mode: 'persisted'
      });
    } else if (this.config.mode === 'profile') {
      let profileBootstrap: ProfileBootstrapState;
      try {
        profileBootstrap = this.buildProfileBootstrap();
      } catch (error) {
        throw withContext('Failed to build profile runtime bootstrap', error);
      }
      const bootstrapPeerPubkey =
        typeof this.config.bootstrapPeerPubkey32Hex === 'string' &&
        this.config.bootstrapPeerPubkey32Hex.trim().length > 0
          ? normalizePubkey32Hex(this.config.bootstrapPeerPubkey32Hex, 'bootstrap peer public key')
          : null;
      if (bootstrapPeerPubkey) {
        try {
          const result = await this.requestOnboardResponse({
            share_secret: profileBootstrap.shareSecret,
            share_pubkey32: this.localSharePubkey32,
            peer_pk_xonly: bootstrapPeerPubkey,
            relays: this.activeRelays
          });
          const bootstrapNonces = Array.isArray(result.response.nonces) ? result.response.nonces : [];
          if (bootstrapNonces.length > 0) {
            profileBootstrap.bootstrap.initial_peer_nonces = [
              {
                peer: bootstrapPeerPubkey,
                nonces: bootstrapNonces
              }
            ];
            this.emitLog('info', 'runtime', 'profile_bootstrap_nonces_seeded', {
              peer_pubkey32: bootstrapPeerPubkey,
              nonce_count: bootstrapNonces.length
            });
          } else {
            this.emitLog('warn', 'runtime', 'profile_bootstrap_nonces_empty', {
              peer_pubkey32: bootstrapPeerPubkey
            });
          }
        } catch (error) {
          this.emitLog('warn', 'runtime', 'profile_bootstrap_nonces_failed', {
            peer_pubkey32: bootstrapPeerPubkey,
            error_message: toErrorMessage(error, 'failed to fetch bootstrap nonces')
          });
        }
      }
      try {
        this.emitLog('info', 'runtime', 'init_runtime_begin', {
          mode: 'profile'
        });
        this.runtime.init_runtime(
          JSON.stringify(runtimeConfig),
          JSON.stringify(profileBootstrap.bootstrap)
        );
        this.emitLog('info', 'runtime', 'init_runtime_ok', {
          mode: 'profile'
        });
      } catch (error) {
        throw withContext('Failed to initialize signer runtime', error);
      }
    } else {
      let onboardResponse: OnboardResponseWire;
      let onboardRequest: OnboardingRequestBundleWire;
      try {
        const result = await this.requestOnboardResponse(decoded!);
        onboardResponse = result.response;
        onboardRequest = result.bundle;
      } catch (error) {
        throw withContext('Failed during onboard request', error);
      }
      this.emitLog('info', 'onboarding', 'response_received', {
        peer_pubkey32: decoded!.peer_pk_xonly.toLowerCase(),
        nonce_count: Array.isArray(onboardResponse.nonces) ? onboardResponse.nonces.length : 0,
        group_member_count: Array.isArray(onboardResponse.group.members)
          ? onboardResponse.group.members.length
          : 0
      });

      const group = onboardResponse.group;
      this.applyGroupState(group);
      const bootstrapPeer = decoded!.peer_pk_xonly.toLowerCase();
      const onboardingApi = await getWasmBridgeOnboardingApi();
      let onboardingSnapshotJson: string;
      try {
        onboardingSnapshotJson = onboardingApi.build_onboarding_runtime_snapshot(
          JSON.stringify(group),
          decoded!.share_secret,
          bootstrapPeer,
          JSON.stringify(onboardResponse.nonces),
          onboardRequest.bootstrap_state_hex
        );
      } catch (error) {
        throw withContext('Failed to finalize onboarding runtime snapshot', error);
      }

      try {
        this.emitLog('info', 'runtime', 'restore_runtime_begin', {
          mode: 'onboarding'
        });
        this.runtime.restore_runtime(JSON.stringify(runtimeConfig), onboardingSnapshotJson);
        this.emitLog('info', 'runtime', 'restore_runtime_ok', {
          mode: 'onboarding'
        });
      } catch (error) {
        throw withContext('Failed to initialize signer runtime', error);
      }
    }

    this.subscribeRelayIngress(nowUnixSecs());

    if (this.config.mode !== 'onboarding' && this.peerPubkeys32.size > 0) {
      try {
        this.emitLog('info', 'runtime', 'startup_peer_refresh_queued', {
          peer_count: this.peerPubkeys32.size,
          peers: Array.from(this.peerPubkeys32),
        });
        this.refreshAllPeers();
      } catch (error) {
        this.emitLog('warn', 'runtime', 'startup_peer_refresh_failed', {
          error_message: toErrorMessage(error, 'failed to refresh peers after startup'),
        });
      }
    }

    this.tickHandle = setInterval(() => {
      this.pumpRuntime(Date.now());
    }, 1_000);

    this.pumpRuntime(Date.now());

    this.emitLog('info', 'runtime', 'bootstrap_complete', {
      relays: this.activeRelays,
      peers: Array.from(this.peerPubkeys32),
      public_key: this.groupPubkey32,
      event_kind: BIFROST_EVENT_KIND
    });

    this.emit('ready');

    const bootstrapPeers = Array.from(this.peerPubkeys32);
    void this.refreshBootstrapPeers(bootstrapPeers);
  }

  async shutdown() {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }

    this.relaySubscription?.close('shutdown');
    this.relaySubscription = null;

    if (this.pool) {
      this.pool.close(this.activeRelays);
      this.pool.destroy();
      this.pool = null;
    }

    while (this.pendingPings.length > 0) {
      const pending = this.pendingPings.shift();
      pending?.resolve({ success: false, error: 'Signer stopped' });
    }

    if (this.pendingCommand) {
      const pending = this.pendingCommand;
      this.pendingCommand = null;
      clearPendingCommand(pending);
      pending.reject(new Error('Signer stopped'));
    }

    this.emit('closed');
  }

  getPublicKey(): string {
    if (!this.groupPubkey32) {
      throw new Error('runtime not initialized');
    }
    return this.groupPubkey32;
  }

  getSharePublicKey(): string {
    if (!this.localSharePubkey32) {
      throw new Error('runtime not initialized');
    }
    return this.localSharePubkey32;
  }

  readConfig(): SignerSettings {
    if (!this.runtime) {
      throw new Error('runtime not initialized');
    }
    return normalizeSignerSettings(
      JSON.parse(this.runtime.read_config()) as Partial<SignerSettings>
    );
  }

  peerPermissionStates(): string {
    if (!this.runtime) {
      throw new Error('runtime not initialized');
    }
    return JSON.stringify(this.runtimeStatus().peer_permission_states ?? []);
  }

  updateConfig(settings: Partial<SignerSettings>): void {
    if (!this.runtime) {
      throw new Error('runtime not initialized');
    }
    this.runtime.update_config(JSON.stringify(normalizeSignerSettings(settings)));
    this.pumpRuntime(Date.now());
  }

  runtimeMetadata(): RuntimeMetadata {
    return this.runtimeStatus().metadata;
  }

  runtimeStatus(): RuntimeStatusSummary {
    if (!this.runtime) {
      throw new Error('runtime not initialized');
    }
    const status = JSON.parse(this.runtime.runtime_status()) as RuntimeStatusSummary;
    this.lastRuntimeStatus = status;
    return status;
  }

  runtimePeerStatus(): RuntimePeerStatus[] {
    return this.runtimeStatus().peers;
  }

  runtimeReadiness(): RuntimeReadiness {
    return this.runtimeStatus().readiness;
  }

  refreshAllPeers(): void {
    if (!this.runtime) {
      throw new Error('runtime not initialized');
    }
    this.runtime.handle_command(JSON.stringify({ type: 'refresh_all_peers' }));
    this.pumpRuntime(Date.now());
  }

  wipeState(): void {
    if (!this.runtime) {
      throw new Error('runtime not initialized');
    }
    this.runtime.wipe_state();
    this.lastRuntimeStatus = null;
    this.pumpRuntime(Date.now());
  }

  async prepareSign(): Promise<RuntimeReadiness> {
    return await this.prepareOperation('sign');
  }

  async prepareEcdh(): Promise<RuntimeReadiness> {
    return await this.prepareOperation('ecdh');
  }

  async fetchPeers(seed: PeerPolicy[]): Promise<PeerPolicy[]> {
    if (!this.runtime) throw new Error('runtime not initialized');

    const base = new Map<string, PeerPolicy>();
    const runtimeStatus = this.runtimeStatus();
    for (const peer of seed) {
      base.set(peer.pubkey.toLowerCase(), peer);
    }

    for (const policy of runtimeStatus.peer_permission_states ?? []) {
      const normalized = policy.pubkey.toLowerCase();
      const existing = base.get(normalized);
      base.set(normalized, {
        alias: existing?.alias || `Peer ${base.size + 1}`,
        pubkey: policy.pubkey,
        send: allPolicyFlagsEnabled(policy.effective_policy.request),
        receive: allPolicyFlagsEnabled(policy.effective_policy.respond),
        state: existing?.state || 'offline'
      });
    }

    for (const peer of runtimeStatus.metadata.peers) {
      if (!base.has(peer)) {
        base.set(peer, {
          alias: `Peer ${base.size + 1}`,
          pubkey: peer,
          send: true,
          receive: true,
          state: 'offline'
        });
      }
    }

    for (const status of runtimeStatus.peers) {
      const normalized = status.pubkey.toLowerCase();
      const existing = base.get(normalized);
      base.set(normalized, {
        alias: existing?.alias || `Peer ${status.idx}`,
        pubkey: normalized,
        send: existing?.send ?? true,
        receive: existing?.receive ?? true,
        state: status.can_sign ? 'warning' : status.online ? 'online' : 'idle',
        statusLabel: status.can_sign ? 'sign-ready' : status.online ? 'online' : 'known',
        lastSeen: status.last_seen
      } as PeerPolicy);
    }

    const peers = Array.from(base.values()).map((peer) => ({
      ...peer,
      pubkey: peer.pubkey.toLowerCase()
    })) as PeerPolicy[];

    peers.sort((a, b) => a.pubkey.localeCompare(b.pubkey));
    return peers;
  }

  async pingPeer(pubkey: string): Promise<PingResult> {
    return await this.pingPeerInternal(pubkey, { quiet: false });
  }

  private async pingPeerInternal(
    pubkey: string,
    options: { quiet: boolean }
  ): Promise<PingResult> {
    if (!this.runtime) return { success: false, error: 'runtime not initialized' };

    const normalized = pubkey.toLowerCase();

    return await new Promise<PingResult>((resolve) => {
      const pending: PendingPing = {
        peer: normalized,
        startedAtMs: Date.now(),
        quiet: options.quiet,
        resolve
      };

      this.pendingPings.push(pending);

      setTimeout(() => {
        const index = this.pendingPings.indexOf(pending);
        if (index >= 0) {
          this.pendingPings.splice(index, 1);
          resolve({ success: false, error: 'Ping timed out' });
        }
      }, PING_TIMEOUT_MS);

      try {
        this.runtime?.handle_command(
          JSON.stringify({ type: 'ping', peer_pubkey32_hex: normalized })
        );
        this.pumpRuntime(Date.now());
      } catch (error) {
        const index = this.pendingPings.indexOf(pending);
        if (index >= 0) this.pendingPings.splice(index, 1);
        resolve({ success: false, error: toErrorMessage(error, 'Ping failed') });
      }
    });
  }

  async updatePeerPolicyOverride(pubkey: string, patch: PeerPolicyOverridePatch): Promise<void> {
    if (!this.runtime) throw new Error('runtime not initialized');
    this.runtime.set_policy_override(
      JSON.stringify({
        peer: pubkey.toLowerCase(),
        direction: patch.direction,
        method: patch.method,
        value: patch.value
      })
    );
    this.pumpRuntime(Date.now());
  }

  async clearPeerPolicyOverrides(): Promise<void> {
    if (!this.runtime) throw new Error('runtime not initialized');
    this.runtime.clear_policy_overrides();
    this.pumpRuntime(Date.now());
  }

  async signNostrEvent(event: Record<string, unknown>): Promise<Event> {
    const pubkey = this.getPublicKey();
    const unsigned = buildUnsignedEvent(event, pubkey);
    const id = getEventHash(unsigned);
    await this.prepareSign();
    const sig = await this.runBridgeCommand('sign', {
      type: 'sign',
      message_hex_32: id
    });

    const signedEvent = {
      ...unsigned,
      id,
      sig
    };

    if (!verifyEvent(signedEvent)) {
      throw new Error('Signed event failed verification');
    }

    return signedEvent;
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    if (typeof plaintext !== 'string') {
      throw new Error('NIP-44 plaintext must be a string');
    }

    await this.prepareEcdh();
    const sharedSecretHex32 = await this.runBridgeCommand('ecdh', {
      type: 'ecdh',
      pubkey32_hex: pubkey.toLowerCase()
    });
    const conversationKey = await deriveConversationKeyFromSharedSecret(sharedSecretHex32);
    return normalizeNip44PayloadForRust(nip44.v2.encrypt(plaintext, conversationKey));
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    if (typeof ciphertext !== 'string') {
      throw new Error('NIP-44 ciphertext must be a string');
    }

    await this.prepareEcdh();
    const sharedSecretHex32 = await this.runBridgeCommand('ecdh', {
      type: 'ecdh',
      pubkey32_hex: pubkey.toLowerCase()
    });
    const conversationKey = await deriveConversationKeyFromSharedSecret(sharedSecretHex32);
    return nip44.v2.decrypt(normalizeNip44PayloadForJs(ciphertext), conversationKey);
  }

  snapshotRuntimeState(): unknown {
    if (!this.runtime) {
      throw new Error('runtime not initialized');
    }

    return JSON.parse(this.runtime.snapshot_state());
  }

  private async refreshBootstrapPeers(peers: string[]): Promise<void> {
    let peersOk = 0;
    for (const peer of peers) {
      const result = await this.pingPeerInternal(peer, { quiet: true });
      if (result.success) {
        peersOk += 1;
      }
    }

    this.emitLog('debug', 'runtime', 'bootstrap_peer_refresh_complete', {
      peers_total: peers.length,
      peers_ok: peersOk
    });
  }

  private async prepareOperation(kind: 'sign' | 'ecdh'): Promise<RuntimeReadiness> {
    const startedAt = Date.now();
    const startedAtSec = Math.floor(startedAt / 1000);
    let lastReadiness: RuntimeReadiness | null = null;
    let refreshed = false;

    while (Date.now() - startedAt < PREPARE_OPERATION_TIMEOUT_MS) {
      const readiness = this.runtimeReadiness();
      lastReadiness = readiness;
      const ready = kind === 'sign' ? readiness.sign_ready : readiness.ecdh_ready;
      const freshnessSatisfied =
        readiness.last_refresh_at !== null && readiness.last_refresh_at >= startedAtSec;
      const degradedButProceedable = canProceedWhileDegraded(kind, readiness.degraded_reasons);
      if ((readiness.restore_complete || degradedButProceedable) && ready && freshnessSatisfied) {
        this.emitLog('debug', 'runtime', 'prepare_complete', {
          operation: kind,
          proceeded_while_degraded: !readiness.restore_complete,
          freshness_satisfied: freshnessSatisfied,
          last_refresh_at: readiness.last_refresh_at,
          threshold: readiness.threshold,
          signing_peer_count: readiness.signing_peer_count,
          ecdh_peer_count: readiness.ecdh_peer_count
        });
        return readiness;
      }

      if (!refreshed) {
        this.emitLog('debug', 'runtime', 'prepare_refresh_begin', {
          operation: kind
        });
        this.refreshAllPeers();
        refreshed = true;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
      this.pumpRuntime(Date.now());
    }

    const reason =
      kind === 'sign'
        ? INSUFFICIENT_SIGNING_PEERS_REASON
        : INSUFFICIENT_ECDH_PEERS_REASON;
    throw new Error(
      `${reason}: ${JSON.stringify(
        lastReadiness ?? {
          runtime_ready: false,
          restore_complete: false,
          sign_ready: false,
          ecdh_ready: false
        }
      )}`
    );
  }

  private async decodeOnboardingPackage(value: string, password: string): Promise<OnboardingDecoded> {
    const decoded = await decodeBfOnboardPackage(value.trim(), password);
    const shareSecret = decoded.shareSecret;
    const peerPubkey = decoded.peerPubkey;
    const relays = decoded.relays;

    const sharePubkey32 = getPublicKey(hexToBytes(shareSecret)).toLowerCase();
    if (sharePubkey32.length !== 64) {
      throw new Error('Invalid onboarding share pubkey');
    }
    if (typeof peerPubkey !== 'string' || peerPubkey.length !== 64) {
      throw new Error('Invalid onboarding peer key');
    }

    return {
      share_secret: shareSecret,
      share_pubkey32: sharePubkey32,
      peer_pk_xonly: peerPubkey,
      relays: Array.isArray(relays)
        ? relays.filter((relay): relay is string => typeof relay === 'string')
        : []
    };
  }

  private applyGroupState(group: GroupPackageWire): string[] {
    this.groupPubkey32 = normalizePubkey32Hex(group.group_pk, 'group public key');
    this.peerPubkeys32 = new Set(
      group.members
        .map((member) => normalizePubkey32Hex(member.pubkey, `group member ${member.idx} pubkey`))
        .filter((pubkey) => pubkey !== this.localSharePubkey32)
    );

    this.xonlyToPeer32.clear();
    for (const member of group.members) {
      const peer32 = normalizePubkey32Hex(member.pubkey, `group member ${member.idx} pubkey`);
      this.xonlyToPeer32.set(peer32, peer32);
    }

    return Array.from(this.peerPubkeys32);
  }

  private parseRuntimeSnapshot(): RuntimeSnapshotWire | null {
    const snapshotJson = this.restoreOptions.runtimeSnapshotJson;
    if (typeof snapshotJson !== 'string' || !snapshotJson.trim()) {
      this.emitLog('info', 'runtime', 'restore_skipped', {
        reason: 'missing_snapshot'
      });
      return null;
    }

    try {
      const parsed = JSON.parse(snapshotJson) as unknown;
      if (!isRecord(parsed) || !isRecord(parsed.bootstrap) || !isRecord(parsed.bootstrap.group)) {
        this.emitLog('warn', 'runtime', 'restore_skipped', {
          reason: 'invalid_snapshot_shape'
        });
        return null;
      }
      if (typeof parsed.state_hex !== 'string' || !parsed.state_hex.trim()) {
        this.emitLog('warn', 'runtime', 'restore_skipped', {
          reason: 'missing_state_hex'
        });
        return null;
      }

      return parsed as RuntimeSnapshotWire;
    } catch {
      this.emitLog('warn', 'runtime', 'restore_skipped', {
        reason: 'snapshot_json_parse_failed'
      });
      return null;
    }
  }

  private tryRestoreRuntime(runtimeConfig: Record<string, unknown>): boolean {
    if (!this.runtime) {
      throw new Error('runtime not initialized');
    }

    const snapshot = this.parseRuntimeSnapshot();
    if (!snapshot) return false;

    try {
      this.localSharePubkey32 = normalizePubkey32Hex(
        getPublicKey(hexToBytes(snapshot.bootstrap.share.seckey)),
        'share public key'
      );
      this.applyGroupState(snapshot.bootstrap.group);
      this.runtime.restore_runtime(JSON.stringify(runtimeConfig), this.restoreOptions.runtimeSnapshotJson!);
      this.emitLog('info', 'runtime', 'restored', {
        mode: 'persisted',
        peers: Array.from(this.peerPubkeys32),
        public_key: this.groupPubkey32
      });
      return true;
    } catch (error) {
      this.emitLog('error', 'runtime', 'restore_failed', {
        error_message: toErrorMessage(error, 'failed to restore runtime snapshot')
      });
      this.groupPubkey32 = '';
      this.peerPubkeys32.clear();
      this.xonlyToPeer32.clear();
      return false;
    }
  }

  private buildProfileBootstrap(): ProfileBootstrapState {
    if (typeof this.config.groupPackageJson !== 'string' || !this.config.groupPackageJson.trim()) {
      throw new Error('Missing group package for profile runtime bootstrap');
    }
    if (typeof this.config.sharePackageJson !== 'string' || !this.config.sharePackageJson.trim()) {
      throw new Error('Missing share package for profile runtime bootstrap');
    }

    let group: GroupPackageWire;
    let share: { idx?: number; seckey?: string };
    try {
      group = JSON.parse(this.config.groupPackageJson) as GroupPackageWire;
      share = JSON.parse(this.config.sharePackageJson) as { idx?: number; seckey?: string };
    } catch {
      throw new Error('Invalid profile bootstrap package JSON');
    }

    if (!isRecord(group) || !Array.isArray(group.members)) {
      throw new Error('Invalid group package for profile runtime bootstrap');
    }
    if (!isRecord(share) || typeof share.seckey !== 'string') {
      throw new Error('Invalid share package for profile runtime bootstrap');
    }

    const shareSecret = normalizeHex32(share.seckey, 'share secret');
    this.localSharePubkey32 = normalizePubkey32Hex(
      getPublicKey(hexToBytes(shareSecret)),
      'share public key'
    );

    return {
      shareSecret,
      bootstrap: {
        group,
        share: {
          idx: typeof share.idx === 'number' ? Math.trunc(share.idx) : 0,
          seckey: shareSecret,
        },
        peers: this.applyGroupState(group),
        initial_peer_nonces: [],
      }
    };
  }

  private async requestOnboardResponse(
    decoded: OnboardingDecoded
  ): Promise<OnboardingRequestResult> {
    if (!this.pool) throw new Error('relay pool not initialized');

    const now = nowUnixSecs();
    const shareSecret = hexToBytes(decoded.share_secret);
    const onboardingApi = await getWasmBridgeOnboardingApi();
    const bundle = parseOnboardingRequestBundle(
      onboardingApi.create_onboarding_request_bundle(
        decoded.share_secret,
        decoded.peer_pk_xonly.toLowerCase(),
        BIFROST_EVENT_KIND,
        now
      )
    );
    const requestId = bundle.request_id;
    const requestEvent = parseEventJson(bundle.event_json, 'onboarding request event');
    const relayUrls = this.relayTargets();
    this.emitLog('info', 'onboarding', 'request_start', {
      request_id: requestId,
      peer_pubkey32: decoded.peer_pk_xonly.toLowerCase(),
      share_pubkey32: bundle.local_pubkey32.toLowerCase(),
      nonce_count: Array.isArray(bundle.request_nonces) ? bundle.request_nonces.length : 0,
      relays: relayUrls
    });

    const conversationKey = nip44.v2.utils.getConversationKey(
      shareSecret,
      decoded.peer_pk_xonly
    );

    const filter = {
      kinds: [BIFROST_EVENT_KIND],
      authors: [decoded.peer_pk_xonly],
      '#p': [bundle.local_pubkey32.toLowerCase()],
      since: now - 30
    } as Filter;

    return await new Promise<OnboardingRequestResult>((resolve, reject) => {
      let settled = false;
      const closeReasons: string[][] = [];
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => {
          subscription.close('onboard-timeout');
          this.emitLog('warn', 'onboarding', 'request_timeout', {
            request_id: requestId,
            peer_pubkey32: decoded.peer_pk_xonly.toLowerCase(),
            share_pubkey32: bundle.local_pubkey32.toLowerCase(),
            relays: relayUrls,
            close_reasons: closeReasons
          });
          reject(
            new Error(
              `Onboard response timed out (request_id=${requestId}, relays=${relayUrls.join(',')})`
            )
          );
        });
      }, ONBOARD_TIMEOUT_MS);

      const subscription = this.pool!.subscribeMany(relayUrls, filter, {
        onevent: (event: Event) => {
          this.emitLog('debug', 'onboarding', 'response_event_received', {
            request_id: requestId,
            event_id: event.id,
            author: event.pubkey,
            tag_p: event.tags
              .filter(([name]) => name === 'p')
              .map(([, value]) => value)
          });
          try {
            const decrypted = nip44.v2.decrypt(
              normalizeNip44PayloadForJs(event.content),
              conversationKey
            );
            const envelope = parseBridgeEnvelope(decrypted);
            if (!envelope) return;
            if (envelope.request_id !== requestId) return;
            if (envelope.payload.type !== 'OnboardResponse') return;
            if (!isRecord(envelope.payload.data)) return;
            if (!isRecord(envelope.payload.data.group)) return;

            finish(() => {
              clearTimeout(timer);
              subscription.close('onboard-complete');
              this.emitLog('info', 'onboarding', 'request_complete', {
                request_id: requestId,
                peer_pubkey32: decoded.peer_pk_xonly.toLowerCase(),
                share_pubkey32: bundle.local_pubkey32.toLowerCase()
              });
              resolve({
                response: envelope.payload.data as OnboardResponseWire,
                bundle
              });
            });
          } catch (error) {
            this.emitLog('debug', 'onboarding', 'response_event_ignored', {
              request_id: requestId,
              event_id: event.id,
              reason: toErrorMessage(error, 'failed to decrypt or parse response event')
            });
          }
        },
        onclose: (reasons: string[]) => {
          if (settled) return;
          closeReasons.push(reasons);
          this.emitLog('warn', 'onboarding', 'request_closed', {
            request_id: requestId,
            reasons,
            relays: relayUrls
          });
        }
      });

      const publishResults = this.pool!.publish(relayUrls, requestEvent);
      Promise.allSettled(publishResults).then((results) => {
        this.emitLog('debug', 'onboarding', 'request_publish', {
          request_id: requestId,
          relays_ok: results.filter((entry: PromiseSettledResult<unknown>) => entry.status === 'fulfilled').length,
          relays_total: results.length
        });
        const hasSuccess = results.some(
          (entry: PromiseSettledResult<unknown>) => entry.status === 'fulfilled'
        );
        if (!hasSuccess && !settled) {
          finish(() => {
            clearTimeout(timer);
            subscription.close('onboard-publish-failed');
            reject(
              new Error(
                `Failed to publish onboard request to relays (request_id=${requestId})`
              )
            );
          });
        }
      });
    });
  }

  private subscribeRelayIngress(sinceUnixSecs: number) {
    if (!this.pool) throw new Error('relay pool not initialized');

    const authors = Array.from(this.xonlyToPeer32.keys());
    const filter = {
      kinds: [BIFROST_EVENT_KIND],
      authors,
      '#p': [this.localSharePubkey32],
      since: sinceUnixSecs
    } as Filter;

    this.relaySubscription = this.pool.subscribeMany(this.relayTargets(), filter, {
      onevent: (event: Event) => {
        try {
          this.runtime?.handle_inbound_event(JSON.stringify(event));
          this.pumpRuntime(Date.now());
        } catch (error) {
          this.emitLog('warn', 'runtime', 'inbound_error', {
            error_message: toErrorMessage(error, 'failed to ingest inbound event')
          });
        }

        this.emitLog('debug', 'relay', 'inbound_event', {
          event_id: event.id,
          event_pubkey: event.pubkey,
          event_created_at: event.created_at,
          event_kind: event.kind
        });
      },
      onclose: (reasons: string[]) => {
        this.emitLog('warn', 'relay', 'subscription_closed', {
          reasons
        });
      }
    });
  }

  private pumpRuntime(nowMs: number) {
    if (!this.runtime) return;

    try {
      this.runtime.tick(nowMs);

      const runtimeEventsRaw = this.runtime.drain_runtime_events();
      const runtimeEvents = JSON.parse(runtimeEventsRaw) as unknown;
      if (Array.isArray(runtimeEvents)) {
        for (const event of runtimeEvents) {
          if (!isRecord(event) || !isRecord(event.status)) continue;
          const runtimeEvent = event as unknown as RuntimeEvent;
          this.lastRuntimeStatus = runtimeEvent.status;
          this.emit('runtime-status', runtimeEvent.status);
          this.emit('runtime-event', runtimeEvent);
          this.emitLog('debug', 'runtime', 'status_event', {
            kind: runtimeEvent.kind,
            sign_ready: runtimeEvent.status.readiness.sign_ready,
            ecdh_ready: runtimeEvent.status.readiness.ecdh_ready,
            pending_ops: runtimeEvent.status.status.pending_ops
          });
        }
      }

      const outboundRaw = this.runtime.drain_outbound_events();
      const outboundEvents = JSON.parse(outboundRaw) as unknown;
      if (Array.isArray(outboundEvents) && this.pool) {
        for (const event of outboundEvents) {
          if (!isRecord(event)) continue;
          const outboundEvent = event as unknown as Event;
          const publishResults = this.pool.publish(this.relayTargets(), outboundEvent);
          Promise.allSettled(publishResults).then((results) => {
            const succeeded = results.filter(
              (entry: PromiseSettledResult<unknown>) => entry.status === 'fulfilled'
            ).length;
            this.emitLog('debug', 'relay', 'publish_complete', {
              event_id: outboundEvent.id,
              relays_ok: succeeded,
              relays_total: results.length
            });
          });
        }
      }

      const completionsRaw = this.runtime.drain_completions();
      const completions = JSON.parse(completionsRaw) as unknown;
      if (Array.isArray(completions)) {
        for (const completion of completions) {
          this.emitLog('debug', 'runtime', 'completion', {
            kind: completionKind(completion),
            request_id: completionRequestId(completion),
          });

          const ping = parsePingCompletion(completion);
          if (ping) {
            const index = this.pendingPings.findIndex(
              (entry) => entry.peer === ping.peer.toLowerCase()
            );
            if (index >= 0) {
              const pending = this.pendingPings.splice(index, 1)[0];
              pending.resolve({
                success: true,
                latency: Date.now() - pending.startedAtMs
              });
            }
          }

          const sign = parseSignCompletion(completion);
          if (sign && this.pendingCommand?.kind === 'sign') {
            const pending = this.pendingCommand;
            this.pendingCommand = null;
            clearPendingCommand(pending);
            pending.resolve(sign.signatures[0]);
          }

          const ecdh = parseEcdhCompletion(completion);
          if (ecdh && this.pendingCommand?.kind === 'ecdh') {
            const pending = this.pendingCommand;
            this.pendingCommand = null;
            clearPendingCommand(pending);
            pending.resolve(ecdh.sharedSecretHex32);
          }

        }
      }

      const failuresRaw = this.runtime.drain_failures();
      const failures = JSON.parse(failuresRaw) as unknown;
      if (Array.isArray(failures)) {
        for (const failure of failures) {
          const parsedFailure = parseOperationFailure(failure);
          const failureDetails = {
            op_type: parsedFailure?.opType,
            message: parsedFailure?.message,
            request_id: failureRequestId(failure),
          };
          if (parsedFailure?.opType === 'ping') {
            const pending = this.pendingPings.shift();
            const error = parsedFailure.message || 'Ping round failed';
            if (pending) {
              if (pending.quiet) {
                this.emitLog('debug', 'runtime', 'failure', failureDetails);
              } else {
                this.emitLog('info', 'runtime', 'failure', failureDetails);
              }
              pending.resolve({
                success: false,
                error
              });
            } else {
              this.emitLog('debug', 'runtime', 'failure', failureDetails);
            }
            continue;
          }

          this.emitLog('warn', 'runtime', 'failure', failureDetails);

          if (
            parsedFailure &&
            this.pendingCommand &&
            parsedFailure.opType === this.pendingCommand.kind
          ) {
            const pending = this.pendingCommand;
            this.pendingCommand = null;
            clearPendingCommand(pending);
            pending.reject(new Error(parsedFailure.message));
          }

        }
      }
    } catch (error) {
      this.emitLog('error', 'runtime', 'pump_failed', {
        error_message: toErrorMessage(error, 'Runtime pump failed')
      });
      this.emit('error', new Error(toErrorMessage(error, 'Runtime pump failed')));
    }
  }

  private enqueueCommand<T>(run: () => Promise<T>): Promise<T> {
    const next = this.commandChain.then(run, run);
    this.commandChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async runBridgeCommand(
    kind: PendingBridgeCommandKind,
    command: Record<string, unknown>
  ): Promise<string> {
    if (!this.runtime) {
      throw new Error('runtime not initialized');
    }

    return await this.enqueueCommand(
      () =>
        new Promise<string>((resolve, reject) => {
          this.emitLog('debug', 'bridge', 'command_start', {
            command_kind: kind
          });
          const timeoutHandle = setTimeout(() => {
            if (!this.pendingCommand || this.pendingCommand.kind !== kind) return;
            this.pendingCommand = null;
            this.emitLog('warn', 'bridge', 'command_timeout', {
              command_kind: kind
            });
            reject(new Error(`${kind} command timed out`));
          }, BRIDGE_COMMAND_TIMEOUT_MS);

          this.pendingCommand = {
            kind,
            resolve,
            reject,
            timeoutHandle
          };

          try {
            this.runtime?.handle_command(JSON.stringify(command));
            this.pumpRuntime(Date.now());
          } catch (error) {
            const pending = this.pendingCommand;
            this.pendingCommand = null;
            clearPendingCommand(pending);
            this.emitLog('error', 'bridge', 'command_failed', {
              command_kind: kind,
              error_message: toErrorMessage(error, `${kind} command failed`)
            });
            reject(new Error(toErrorMessage(error, `${kind} command failed`)));
          }
        })
    );
  }
}

function isBrowserBridgeNode(node: NodeWithEvents): node is BrowserBridgeNode {
  return (
    typeof (node as BrowserBridgeNode).connect === 'function' &&
    typeof (node as BrowserBridgeNode).shutdown === 'function' &&
    typeof (node as BrowserBridgeNode).fetchPeers === 'function'
  );
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

export function normalizeRelays(relays: string[]): { relays: string[]; errors: string[] } {
  const base = relays.filter((relay) => typeof relay === 'string' && relay.trim().length > 0);
  const normalized = ensureArray(base.map((relay) => relay.trim()));

  const valid = normalized.filter(isRelayUrl);
  const errors = normalized
    .filter((relay) => !isRelayUrl(relay))
    .map((relay) => `Invalid relay URL: ${relay}`);

  return {
    relays: valid.length ? valid : DEFAULT_RELAYS,
    errors
  };
}

export function createSignerNode(
  config: RuntimeConfig,
  restoreOptions?: RuntimeRestoreOptions
): NodeWithEvents {
  return new BrowserBridgeNode(config, restoreOptions);
}

export async function connectSignerNode(node: NodeWithEvents) {
  if (!isBrowserBridgeNode(node)) {
    throw new Error('Unsupported signer node implementation');
  }
  await node.connect();
}

export async function startSignerNode(config: RuntimeConfig) {
  const node = createSignerNode(config);
  await connectSignerNode(node);
  return node;
}

export function stopSignerNode(node: NodeWithEvents | null) {
  if (!node || !isBrowserBridgeNode(node)) return;
  void node.shutdown();
}

export async function refreshPeerStatuses(
  node: NodeWithEvents,
  peers: PeerPolicy[]
): Promise<PeerPolicy[]> {
  if (!isBrowserBridgeNode(node)) return peers;

  try {
    return await node.fetchPeers(peers);
  } catch (error) {
    logger.warn('ui', 'refresh_peers_failed', {
      error_message: toErrorMessage(error, 'failed to refresh peer status')
    });
    return peers;
  }
}

export async function pingSinglePeer(node: NodeWithEvents, pubkey: string): Promise<PingResult> {
  if (!isBrowserBridgeNode(node)) {
    return { success: false, error: 'Unsupported signer node implementation' };
  }

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
  node: NodeWithEvents,
  event: string,
  handler: (...args: unknown[]) => void
) {
  try {
    if (typeof node.off === 'function') {
      node.off(event, handler);
    } else if (typeof node.removeListener === 'function') {
      node.removeListener(event, handler);
    }
  } catch (error) {
    logger.warn('runtime', 'detach_listener_failed', {
      event_name: event,
      error_message: toErrorMessage(error, `Failed to detach event ${event}`)
    });
  }
}

export async function signNostrEvent(
  node: NodeWithEvents,
  event: Record<string, unknown>
): Promise<Event> {
  if (!isBrowserBridgeNode(node) || typeof node.signNostrEvent !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return await node.signNostrEvent(event);
}

export function getPublicKeyFromNode(node: NodeWithEvents): string {
  if (!isBrowserBridgeNode(node) || typeof node.getPublicKey !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return node.getPublicKey();
}

export function getSharePublicKeyFromNode(node: NodeWithEvents): string {
  if (!isBrowserBridgeNode(node) || typeof node.getSharePublicKey !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return node.getSharePublicKey();
}

export function getRuntimeConfigFromNode(node: NodeWithEvents): SignerSettings {
  if (!isBrowserBridgeNode(node) || typeof node.readConfig !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return node.readConfig();
}

export function getRuntimePeerPermissionStatesFromNode(
  node: NodeWithEvents
): RuntimePeerPermissionState[] {
  if (!isBrowserBridgeNode(node) || typeof node.peerPermissionStates !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  const states = JSON.parse(node.peerPermissionStates()) as RuntimePeerPermissionState[];
  return Array.isArray(states)
    ? [...states].sort((a, b) => a.pubkey.localeCompare(b.pubkey))
    : [];
}

export async function updateRuntimePeerPolicyOverrideOnNode(
  node: NodeWithEvents,
  pubkey: string,
  patch: PeerPolicyOverridePatch
) {
  if (!isBrowserBridgeNode(node) || typeof node.updatePeerPolicyOverride !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  await node.updatePeerPolicyOverride(pubkey, patch);
}

export async function clearRuntimePeerPolicyOverridesOnNode(node: NodeWithEvents) {
  if (!isBrowserBridgeNode(node) || typeof node.clearPeerPolicyOverrides !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  await node.clearPeerPolicyOverrides();
}

export function updateRuntimeConfigOnNode(
  node: NodeWithEvents,
  settings: Partial<SignerSettings>
): void {
  if (!isBrowserBridgeNode(node) || typeof node.updateConfig !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  node.updateConfig(settings);
}

export function getRuntimeMetadata(node: NodeWithEvents): RuntimeMetadata {
  if (!isBrowserBridgeNode(node) || typeof node.runtimeMetadata !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return node.runtimeMetadata();
}

export function getRuntimePeerStatus(node: NodeWithEvents): RuntimePeerStatus[] {
  if (!isBrowserBridgeNode(node) || typeof node.runtimePeerStatus !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return node.runtimePeerStatus();
}

export function getRuntimeReadiness(node: NodeWithEvents): RuntimeReadiness {
  if (!isBrowserBridgeNode(node) || typeof node.runtimeReadiness !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return node.runtimeReadiness();
}

export function refreshAllPeersOnNode(node: NodeWithEvents): void {
  if (!isBrowserBridgeNode(node) || typeof node.refreshAllPeers !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  node.refreshAllPeers();
}

export function wipeRuntimeStateOnNode(node: NodeWithEvents): void {
  if (!isBrowserBridgeNode(node) || typeof node.wipeState !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  node.wipeState();
}

export async function prepareSignOnNode(node: NodeWithEvents): Promise<RuntimeReadiness> {
  if (!isBrowserBridgeNode(node) || typeof node.prepareSign !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return await node.prepareSign();
}

export async function prepareEcdhOnNode(node: NodeWithEvents): Promise<RuntimeReadiness> {
  if (!isBrowserBridgeNode(node) || typeof node.prepareEcdh !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return await node.prepareEcdh();
}

export async function nip44EncryptWithNode(
  node: NodeWithEvents,
  pubkey: string,
  plaintext: string
): Promise<string> {
  if (!isBrowserBridgeNode(node) || typeof node.nip44Encrypt !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return await node.nip44Encrypt(pubkey, plaintext);
}

export async function nip44DecryptWithNode(
  node: NodeWithEvents,
  pubkey: string,
  ciphertext: string
): Promise<string> {
  if (!isBrowserBridgeNode(node) || typeof node.nip44Decrypt !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return await node.nip44Decrypt(pubkey, ciphertext);
}

export function getRuntimeSnapshot(node: NodeWithEvents): unknown {
  if (!isBrowserBridgeNode(node) || typeof node.snapshotRuntimeState !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return node.snapshotRuntimeState();
}

export function getRuntimeStatus(node: NodeWithEvents): RuntimeStatusSummary {
  if (!isBrowserBridgeNode(node) || typeof node.runtimeStatus !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return node.runtimeStatus();
}
