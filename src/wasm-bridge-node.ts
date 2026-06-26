// BrowserBridgeNode — the WASM-backed signer node.
//
// PR30: the class moved verbatim out of `browser-runtime-core.ts`. The
// standalone helpers it relies on were split into topical modules:
//   - `runtime-internal.ts`  — shared low-level utilities + constants
//   - `relay-transport.ts`   — relay-URL normalization
//   - `onboarding-transport.ts` — onboarding decode/validate + decrypt counter
//   - `runtime-pump.ts`      — pending-command correlation + completion parsers
// This module keeps the relay/SimplePool lifecycle, onboarding relay
// round-trip, and tick/drain loop together on the class, because they share
// the instance's mutable `this` state and are not separable without a
// behavior-changing rewrite.

import { SimplePool, getPublicKey, nip44, type Event, type Filter } from 'nostr-tools';
import { getEventHash, verifyEvent } from 'nostr-tools/pure';

import {
  createWasmBridgeRuntime,
  getWasmBridgeOnboardingApi,
  type WasmBridgeRuntimeApi
} from './bridge-wasm-runtime';
import { decodeBfOnboardPackage } from './profile-package';
import { RuntimeReadinessTimeoutError } from './errors';
import { Secret } from './secret';
import { normalizeNip44PayloadForJs } from './nip44-normalize';
import { normalizeSignerSettings, type SignerSettings } from './signer-settings';
import {
  BIFROST_EVENT_KIND,
  ONBOARD_TIMEOUT_MS,
  PING_TIMEOUT_MS,
  BRIDGE_COMMAND_TIMEOUT_MS,
  PREPARE_OPERATION_TIMEOUT_MS,
  WASM_RUNTIME_INIT_TIMEOUT_MS,
  RELAY_CONNECT_TIMEOUT_MS,
  RELAY_HEALTH_INTERVAL_MS,
  logger,
  withTimeout,
  canProceedWhileDegraded,
  nowUnixSecs,
  isRecord,
  toErrorMessage,
  withContext,
  normalizePubkey32Hex,
  hexToBytes,
  allPolicyFlagsEnabled,
  deriveConversationKeyFromSharedSecret,
  buildUnsignedEvent,
  sharePubkeyFromSeckeyHex
} from './runtime-internal';
import { normalizeRelays } from './relay-transport';
import {
  createOnboardingDecryptCounter,
  recordOnboardingDecryptAttempt,
  parseBridgeEnvelope,
  parseOnboardingRequestBundle,
  parseEventJson,
  type PeerPolicyOverridePatch
} from './onboarding-transport';
import {
  buildOnboardResponseFilter,
  resolveOnboardResponseEnvelope,
} from './onboard-response';
import { buildProfileBootstrap as buildProfileBootstrapState } from './profile-bootstrap';
import { buildRuntimeDeviceConfig } from './runtime-config';
import {
  createPendingBridgeCommandState,
  matchBridgeCompletion,
  clearPendingCommand,
  parsePingCompletion,
  parseSignCompletion,
  parseEcdhCompletion,
  parseOnboardServedCompletion,
  parseOperationFailure,
  completionKind,
  completionRequestId,
  failureRequestId,
  type PendingBridgeCommand,
  type PendingBridgeCommandKind,
  type PendingBridgeCommandState
} from './runtime-pump';
import type {
  DecodedOnboardingProfile,
  GroupPackageWire,
  OnboardingDecoded,
  OnboardingRequestBundleWire,
  OnboardingRequestResult,
  OnboardResponseWire,
  ProfileBootstrapState,
  RuntimeConfig,
  RuntimeEvent,
  RuntimeMetadata,
  RuntimePeerStatus,
  RuntimeReadiness,
  RuntimeRestoreOptions,
  RuntimeSnapshotWire,
  RuntimeStatusSummary
} from './wire';

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

type PendingPing = {
  peer: string;
  startedAtMs: number;
  quiet: boolean;
  resolve: (value: PingResult) => void;
};

export class BrowserBridgeNode {
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  private pool: SimplePool | null = null;
  private relaySubscription: { close: (reason?: string) => void } | null = null;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private relayHealthHandle: ReturnType<typeof setInterval> | null = null;
  // Pause the relay-health re-probe while the tab is backgrounded (nothing is
  // watching the dashboard). Bound once so add/removeEventListener match. A
  // no-op where there is no `document` (the chrome MV3 service worker, which the
  // browser already lifecycle-suspends when idle).
  private readonly onVisibilityChange = (): void => {
    if (!this.pool) return; // not connected; nothing to probe
    if (typeof document !== 'undefined' && document.hidden) {
      this.stopRelayHealthProbe();
    } else if (!this.relayHealthHandle) {
      this.startRelayHealthProbe();
      // Connectivity may have changed while hidden — refresh now, don't wait a tick.
      void this.refreshRelayHealth()
        .then((changed) => {
          if (changed) this.pumpRuntime(Date.now());
        })
        .catch(() => {});
    }
  };
  private runtime: WasmBridgeRuntimeApi | null = null;

  private activeRelays: string[] = [];
  private localSharePubkey32 = '';
  private groupPubkey32 = '';
  private peerPubkeys32 = new Set<string>();
  private xonlyToPeer32 = new Map<string, string>();
  private pendingPings: PendingPing[] = [];
  /**
   * Outstanding bridge commands keyed by `requestId`. A map (not a single
   * slot) so that completion dispatch is id-correlated rather than matched
   * by operation kind — which previously allowed a stale completion for a
   * timed-out operation to bind to the next command of the same kind.
   *
   * Entries initially use a TS-generated client id (since the WASM
   * `handle_command` entry point does not accept nor return the
   * bifrost-rs-generated `request_id`). The entry is re-keyed to the
   * bifrost-rs id the first time a matching completion arrives, via the
   * per-kind FIFO carried inside `pendingCommandState`.
   */
  private pendingCommandState: PendingBridgeCommandState =
    createPendingBridgeCommandState();
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

    // Bootstrap probe (verbose per-relay logs); refuse to start with zero relays.
    await this.refreshRelayHealth({ verbose: true });

    if (this.connectedRelays.size === 0) {
      const reasons = Array.from(this.relayConnectionFailures.entries()).map(
        ([relay, reason]) => `${relay}: ${reason}`
      );
      throw new Error(`No connected relays available (${reasons.join('; ')})`);
    }
  }

  /**
   * Re-probe every configured relay and recompute `connectedRelays` /
   * `relayConnectionFailures`. Returns whether the connected set changed.
   *
   * Bootstrap calls this with `verbose: true` to keep the per-relay probe logs;
   * the background interval calls it quietly (the connected-set change is
   * surfaced to the UI via `runtime_status()`, not log spam). Unlike the old
   * bootstrap loop it does NOT throw on zero connected — post-boot "zero
   * connected" is a valid all-relays-offline state the dashboard renders.
   */
  private async refreshRelayHealth(opts: { verbose?: boolean } = {}): Promise<boolean> {
    if (!this.pool) return false;
    const verbose = opts.verbose ?? false;
    const previous = this.connectedRelays;
    const connected = new Set<string>();
    const failures = new Map<string, string>();

    for (const relay of this.activeRelays) {
      try {
        if (verbose) this.emitLog('debug', 'relay', 'probe_start', { relay });
        await this.probeRelayWebSocket(relay);
        if (verbose) this.emitLog('debug', 'relay', 'probe_ok', { relay });
      } catch (error) {
        const message = toErrorMessage(error, 'relay websocket probe failed');
        failures.set(relay, message);
        if (verbose) this.emitLog('warn', 'relay', 'probe_failed', { relay, error_message: message });
        continue;
      }

      try {
        await this.pool.ensureRelay(relay, { connectionTimeout: 3_000 });
        connected.add(relay);
        if (verbose) this.emitLog('info', 'relay', 'connected', { relay });
      } catch (error) {
        const message = toErrorMessage(error, 'relay connection failed');
        failures.set(relay, message);
        if (verbose) this.emitLog('warn', 'relay', 'connect_failed', { relay, error_message: message });
      }
    }

    this.connectedRelays = connected;
    this.relayConnectionFailures = failures;
    return (
      previous.size !== connected.size ||
      Array.from(connected).some((relay) => !previous.has(relay))
    );
  }

  private startRelayHealthProbe(): void {
    if (this.relayHealthHandle) return;
    this.relayHealthHandle = setInterval(() => {
      void this.refreshRelayHealth()
        .then((changed) => {
          if (changed) this.pumpRuntime(Date.now());
        })
        .catch(() => {
          /* refreshRelayHealth swallows per-relay errors; nothing to surface */
        });
    }, RELAY_HEALTH_INTERVAL_MS);
  }

  private stopRelayHealthProbe(): void {
    if (this.relayHealthHandle) {
      clearInterval(this.relayHealthHandle);
      this.relayHealthHandle = null;
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

    // `enableReconnect` is not in nostr-tools' published SimplePool ctor type;
    // `as never` passes the runtime option through that type gap.
    this.pool = new SimplePool({ enableReconnect: true } as never);

    const runtimeConfig = buildRuntimeDeviceConfig(this.config.signerSettings);

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
      if (restored) {
        this.emitLog('info', 'runtime', 'restore_runtime_ok', {
          mode: 'persisted'
        });
      } else if (this.hasProfileBootstrapPackages()) {
        // Resilient restore: a snapshot that is structurally valid JSON but
        // semantically incompatible with the current runtime (or otherwise
        // un-restorable) must not brick the session. Fall back to a clean
        // bootstrap from the profile packages carried alongside the snapshot.
        this.emitLog('warn', 'runtime', 'restore_fallback_to_profile', {
          reason: 'snapshot_restore_failed'
        });
        await this.bootstrapFromProfilePackages(runtimeConfig);
      } else {
        throw new Error('Failed to restore runtime snapshot');
      }
    } else if (this.config.mode === 'profile') {
      await this.bootstrapFromProfilePackages(runtimeConfig);
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
          decoded!.share_secret.expose(),
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

    // Background relay-health re-probe: keeps connected_relays current so the
    // dashboard can detect relays dropping/recovering after bootstrap. Paused
    // while the tab is hidden (see onVisibilityChange).
    this.startRelayHealthProbe();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      // Sync to the initial visibility (pauses immediately if started hidden).
      this.onVisibilityChange();
    }

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

    this.stopRelayHealthProbe();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
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

    if (this.pendingCommandState.commands.size > 0) {
      const entries = Array.from(this.pendingCommandState.commands.values());
      this.pendingCommandState = createPendingBridgeCommandState();
      for (const pending of entries) {
        clearPendingCommand(pending);
        if (pending.status === 'pending') {
          pending.reject(new Error('Signer stopped'));
        }
      }
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
    // Bridge-enrich the core read model: relay sockets live in this bridge, not
    // the signer core (which emits these as null). `last_load_error` stays a
    // host signal — a hard restore failure throws out of connect() (no runtime
    // to read), so clients drive load-failed from their own activation error.
    status.configured_relays = this.activeRelays;
    status.connected_relays = Array.from(this.connectedRelays);
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

  /**
   * Resolve a parked approval request (the `ask` policy disposition). Replays the
   * request and emits its response when `approved`, otherwise sends the requester
   * an `operator_denied` error. Fire-and-forget over the command surface.
   */
  async resolveApproval(requestId: string, approved: boolean): Promise<void> {
    if (!this.runtime) throw new Error('runtime not initialized');
    this.runtime.handle_command(
      JSON.stringify({ type: 'resolve_approval', request_id: requestId, approved })
    );
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
    // Return standard, canonically-padded NIP-44 base64 (what `nip44.v2.encrypt`
    // emits) so the app-facing `window.nostr.nip44.encrypt` ciphertext is decodable
    // by any standard nostr client. Stripping the `=` padding here (the old
    // `normalizeNip44PayloadForRust`) broke interop: strict decoders (nostr-tools /
    // @scure/base) reject unpadded base64. The decrypt path below still accepts both
    // forms via `normalizeNip44PayloadForJs`, so legacy unpadded payloads still work.
    return nip44.v2.encrypt(plaintext, conversationKey);
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

    const threshold = lastReadiness?.threshold ?? 0;
    const signingPeerCount = lastReadiness?.signing_peer_count ?? 0;
    const ecdhPeerCount = lastReadiness?.ecdh_peer_count ?? 0;
    const degradedReasonCount = Array.isArray(lastReadiness?.degraded_reasons)
      ? lastReadiness.degraded_reasons.length
      : 0;
    throw new RuntimeReadinessTimeoutError(
      kind,
      threshold,
      signingPeerCount,
      ecdhPeerCount,
      degradedReasonCount,
    );
  }

  private async decodeOnboardingPackage(value: string, password: string): Promise<OnboardingDecoded> {
    const decoded = await decodeBfOnboardPackage(value.trim(), Secret.of(password));
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
      share_secret: Secret.of(shareSecret),
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
      this.localSharePubkey32 = sharePubkeyFromSeckeyHex(snapshot.bootstrap.share.seckey);
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

  private hasProfileBootstrapPackages(): boolean {
    return (
      typeof this.config.groupPackageJson === 'string' &&
      this.config.groupPackageJson.trim().length > 0 &&
      typeof this.config.sharePackageJson === 'string' &&
      this.config.sharePackageJson.trim().length > 0
    );
  }

  /**
   * Clean-bootstrap the runtime from the profile packages (group + share),
   * seeding bootstrap nonces from the inviter peer when one is configured. This
   * is the `profile`-mode path, and also the fallback the `persisted` path uses
   * when a snapshot fails to restore.
   */
  private async bootstrapFromProfilePackages(runtimeConfig: Record<string, unknown>): Promise<void> {
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
          share_secret: Secret.of(profileBootstrap.shareSecret),
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
      this.runtime!.init_runtime(
        JSON.stringify(runtimeConfig),
        JSON.stringify(profileBootstrap.bootstrap)
      );
      this.emitLog('info', 'runtime', 'init_runtime_ok', {
        mode: 'profile'
      });
    } catch (error) {
      throw withContext('Failed to initialize signer runtime', error);
    }
  }

  private buildProfileBootstrap(): ProfileBootstrapState {
    const built = buildProfileBootstrapState({
      groupPackageJson: this.config.groupPackageJson,
      sharePackageJson: this.config.sharePackageJson,
    });
    this.localSharePubkey32 = built.localSharePubkey32;
    this.groupPubkey32 = built.groupPubkey32;
    this.peerPubkeys32 = new Set(built.peerPubkeys32);
    this.xonlyToPeer32 = new Map(built.xonlyToPeer32Entries);
    return {
      shareSecret: built.shareSecret,
      bootstrap: built.bootstrap,
    };
  }

  private async requestOnboardResponse(
    decoded: OnboardingDecoded
  ): Promise<OnboardingRequestResult> {
    if (!this.pool) throw new Error('relay pool not initialized');

    const now = nowUnixSecs();
    const shareSecret = hexToBytes(decoded.share_secret.expose());
    const onboardingApi = await getWasmBridgeOnboardingApi();
    const bundle = parseOnboardingRequestBundle(
      onboardingApi.create_onboarding_request_bundle(
        decoded.share_secret.expose(),
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

    const filter = buildOnboardResponseFilter({
      eventKind: BIFROST_EVENT_KIND,
      peerPubkey32: decoded.peer_pk_xonly,
      localPubkey32: bundle.local_pubkey32,
      since: now - 30,
    });

    return await new Promise<OnboardingRequestResult>((resolve, reject) => {
      let settled = false;
      const closeReasons: string[][] = [];
      // Per-request decrypt budget. Reset on every new onboarding request
      // rather than globally, so a legitimate retry by the operator is not
      // penalized by a prior adversarial burst.
      const decryptCounter = createOnboardingDecryptCounter();
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
          const budget = recordOnboardingDecryptAttempt(decryptCounter);
          if (budget !== 'allow') {
            if (budget === 'cap_reached_first') {
              this.emitLog('warn', 'onboarding', 'decrypt_cap_reached', {
                request_id: requestId,
              });
            }
            return;
          }
          try {
            const decrypted = nip44.v2.decrypt(
              normalizeNip44PayloadForJs(event.content),
              conversationKey
            );
            const envelope = parseBridgeEnvelope(decrypted);
            if (!envelope) return;
            const resolved = resolveOnboardResponseEnvelope(envelope, requestId, bundle.local_pubkey32);
            if (resolved.kind === 'ignore') {
              if (
                resolved.reason === 'peer_not_in_group' ||
                resolved.reason === 'duplicate_members' ||
                resolved.reason === 'bad_threshold'
              ) {
                this.emitLog('warn', 'onboarding', resolved.reason, {
                  request_id: requestId,
                });
              }
              return;
            }

            finish(() => {
              clearTimeout(timer);
              subscription.close('onboard-complete');
              this.emitLog('info', 'onboarding', 'request_complete', {
                request_id: requestId,
                peer_pubkey32: decoded.peer_pk_xonly.toLowerCase(),
                share_pubkey32: bundle.local_pubkey32.toLowerCase()
              });
              resolve({
                response: resolved.response,
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

        this.emitLog('info', 'relay', 'inbound_event', {
          event_id: event.id,
          event_pubkey: event.pubkey,
          event_created_at: event.created_at,
          event_kind: event.kind,
          message: 'Inbound relay event received',
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
          if (runtimeEvent.kind === 'inbound_accepted') {
            this.emitLog('info', 'runtime', 'inbound_accepted', {
              pending_ops: runtimeEvent.status.status.pending_ops,
              sign_ready: runtimeEvent.status.readiness.sign_ready,
              ecdh_ready: runtimeEvent.status.readiness.ecdh_ready,
              message: 'Inbound runtime event accepted',
            });
          }
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
            this.emitLog('info', 'relay', 'publish_complete', {
              event_id: outboundEvent.id,
              relays_ok: succeeded,
              relays_total: results.length,
              message: 'Relay publish completed',
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
              const elapsedMs = Date.now() - pending.startedAtMs;
              this.emitLog(pending.quiet ? 'debug' : 'info', 'ping', 'complete', {
                request_id: ping.requestId,
                peer: ping.peer.toLowerCase(),
                elapsed_ms: elapsedMs,
                message: `Ping completed in ${elapsedMs}ms`,
              });
              pending.resolve({
                success: true,
                latency: elapsedMs
              });
            }
          }

          const sign = parseSignCompletion(completion);
          if (sign) {
            this.dispatchBridgeCompletion('sign', sign.requestId, (pending) => {
              this.emitLog('info', 'sign', 'complete', {
                request_id: sign.requestId,
                signature_count: sign.signatures.length,
                message: 'Sign request completed',
              });
              pending.resolve(sign.signatures[0]);
            });
          }

          const ecdh = parseEcdhCompletion(completion);
          if (ecdh) {
            this.dispatchBridgeCompletion('ecdh', ecdh.requestId, (pending) => {
              this.emitLog('info', 'ecdh', 'complete', {
                request_id: ecdh.requestId,
                message: 'ECDH request completed',
              });
              pending.resolve(ecdh.sharedSecretHex32);
            });
          }

          const onboardServed = parseOnboardServedCompletion(completion);
          if (onboardServed) {
            this.emitLog('info', 'onboarding', 'peer_onboarded', {
              peer_pubkey: onboardServed.peerPubkey,
              message: 'Peer onboarded',
            });
            this.emit('onboard-complete', { peerPubkey: onboardServed.peerPubkey });
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
            reason_code: parsedFailure?.reasonCode,
            failed_peer: parsedFailure?.failedPeer,
            request_id: failureRequestId(failure),
          };
          if (parsedFailure?.opType === 'ping') {
            const pending = this.pendingPings.shift();
            const error = parsedFailure.message || 'Ping round failed';
            if (pending) {
              if (pending.quiet) {
                this.emitLog('debug', 'runtime', 'failure', failureDetails);
              } else {
                this.emitLog('info', 'ping', 'failure', {
                  ...failureDetails,
                  peer: pending.peer,
                  message: error,
                });
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
            (parsedFailure.opType === 'sign' || parsedFailure.opType === 'ecdh')
          ) {
            const failureId = failureRequestId(failure);
            if (typeof failureId === 'string' && failureId.length > 0) {
              this.dispatchBridgeCompletion(
                parsedFailure.opType,
                failureId,
                (pending) => pending.reject(new Error(parsedFailure.message)),
              );
            }
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

  /**
   * Associate a completion (identified by bifrost-rs `request_id`) with its
   * pending command entry and invoke `onMatch`. If no matching entry exists
   * (or the matched entry was already consumed by a timeout), emits a
   * `runtime.stale_completion` observability event and returns without
   * resolving any promise.
   */
  private dispatchBridgeCompletion(
    kind: PendingBridgeCommandKind,
    completionRequestId: string,
    onMatch: (pending: PendingBridgeCommand) => void,
  ): void {
    const outcome = matchBridgeCompletion(
      this.pendingCommandState,
      kind,
      completionRequestId,
    );
    if (outcome.kind === 'resolved') {
      clearPendingCommand(outcome.entry);
      onMatch(outcome.entry);
      return;
    }
    this.emitLog('warn', 'runtime', 'stale_completion', {
      request_id: outcome.requestId,
      kind: outcome.op,
    });
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
          // Generate a TS-side correlation id. The bifrost-rs WASM bridge
          // presently generates its own `request_id` inside the signer and
          // emits it back on the completion; we store the pending entry under
          // a client-generated UUID and re-key on first matching completion
          // (see `dispatchBridgeCompletion`). Using a UUID guarantees no
          // collision with a bifrost-rs-generated id.
          const requestId = crypto.randomUUID();
          this.emitLog('debug', 'bridge', 'command_start', {
            command_kind: kind
          });
          const timeoutHandle = setTimeout(() => {
            const entry = this.pendingCommandState.commands.get(requestId);
            if (!entry || entry.status !== 'pending') return;
            // Leave the entry in the FIFO as a tombstone so a late
            // completion for this command consumes it (and is logged as a
            // stale completion) instead of binding to a fresher command of
            // the same kind.
            entry.status = 'timed_out';
            this.emitLog('warn', 'bridge', 'command_timeout', {
              command_kind: kind
            });
            reject(new Error(`${kind} command timed out`));
          }, BRIDGE_COMMAND_TIMEOUT_MS);

          this.pendingCommandState.commands.set(requestId, {
            requestId,
            kind,
            resolve,
            reject,
            timeoutHandle,
            status: 'pending',
          });
          this.pendingCommandState.kindFifo[kind].push(requestId);

          try {
            // NOTE: `request_id` is included in the outgoing payload for
            // forward-compatibility. The current WASM bridge ignores extra
            // fields and generates its own id; the completion's id is what
            // dispatches this entry. A future bridge change that echoes this
            // id will make dispatch a fast-path map lookup.
            this.runtime?.handle_command(
              JSON.stringify({ ...command, request_id: requestId })
            );
            this.pumpRuntime(Date.now());
          } catch (error) {
            const pending = this.pendingCommandState.commands.get(requestId);
            this.pendingCommandState.commands.delete(requestId);
            const fifoIndex =
              this.pendingCommandState.kindFifo[kind].indexOf(requestId);
            if (fifoIndex >= 0) {
              this.pendingCommandState.kindFifo[kind].splice(fifoIndex, 1);
            }
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
