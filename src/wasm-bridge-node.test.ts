import { beforeEach, describe, expect, test, vi } from 'vitest';

import { BrowserBridgeNode } from './wasm-bridge-node';
import {
  resetWasmBridgeLoaderConfig,
  setInjectedWasmBridgeModuleForTests,
} from './bridge-wasm-runtime';
import { Nip44NormalizeError } from './nip44-normalize';
import type { RuntimeConfig } from './wire';

// PR-I4 (R3 / Bucket I): BrowserBridgeNode (the post-G.2 split's largest module)
// had zero direct tests. The full connect-success + sign round-trip is exercised
// by the cross-repo demo/e2e harness (it needs a real WASM build + relay). These
// unit tests cover the parts reachable in isolation: construction, the event
// emitter surface, the not-initialized guard clauses, shutdown safety, and the
// real connect() WASM-load error path.

const baseConfig: RuntimeConfig = { mode: 'persisted', relays: [] };

beforeEach(() => {
  // Ensure no WASM module/loader is configured so connect() exercises the
  // unconfigured-loader error path deterministically.
  setInjectedWasmBridgeModuleForTests(null);
  resetWasmBridgeLoaderConfig();
});

describe('construction', () => {
  test('exposes the expected public surface', () => {
    const node = new BrowserBridgeNode(baseConfig);
    for (const method of ['connect', 'shutdown', 'on', 'off', 'runtimeStatus', 'getPublicKey']) {
      expect(typeof (node as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });
});

describe('event emitter surface', () => {
  test('on/off register and unregister handlers; shutdown emits "closed"', async () => {
    const node = new BrowserBridgeNode(baseConfig);
    const kept = vi.fn();
    const removed = vi.fn();
    node.on('closed', kept);
    node.on('closed', removed);
    node.off('closed', removed);

    await node.shutdown();

    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  test('removeListener is an alias for off', async () => {
    const node = new BrowserBridgeNode(baseConfig);
    const handler = vi.fn();
    node.on('closed', handler);
    node.removeListener('closed', handler);
    await node.shutdown();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('not-initialized guards', () => {
  test('state reads throw before connect()', () => {
    const node = new BrowserBridgeNode(baseConfig);
    expect(() => node.getPublicKey()).toThrow('runtime not initialized');
    expect(() => node.getSharePublicKey()).toThrow('runtime not initialized');
    expect(() => node.runtimeStatus()).toThrow('runtime not initialized');
    expect(() => node.readConfig()).toThrow('runtime not initialized');
  });
});

describe('shutdown', () => {
  test('is safe and idempotent on a never-connected node', async () => {
    const node = new BrowserBridgeNode(baseConfig);
    await expect(node.shutdown()).resolves.toBeUndefined();
    // A second shutdown must not throw.
    await expect(node.shutdown()).resolves.toBeUndefined();
  });
});

describe('connect error path', () => {
  test('rejects with a contextful error when the WASM loader is unconfigured', async () => {
    const node = new BrowserBridgeNode(baseConfig);
    await expect(node.connect()).rejects.toThrow('Failed to load WASM runtime');
  });
});

describe('ping timeout peer availability', () => {
  function installRuntimeWithPeers(
    node: BrowserBridgeNode,
    peers: string[],
    failures: unknown[] = [],
  ) {
    (node as unknown as { runtime: unknown }).runtime = {
      tick: () => {},
      handle_command: vi.fn(),
      runtime_status: () =>
        JSON.stringify({
          status: {
            device_id: 'browser-device',
            pending_ops: 0,
            last_active: 1,
            known_peers: peers.length,
            request_seq: 1,
          },
          metadata: {
            device_id: 'browser-device',
            member_idx: 1,
            share_public_key: '11'.repeat(32),
            group_public_key: '22'.repeat(32),
            peers,
          },
          readiness: {
            runtime_ready: true,
            restore_complete: true,
            sign_ready: false,
            ecdh_ready: false,
            threshold: 2,
            signing_peer_count: 0,
            ecdh_peer_count: 0,
            last_refresh_at: 1,
            degraded_reasons: [],
          },
          peers: peers.map((peer, index) => ({
            idx: index + 2,
            pubkey: peer,
            known: true,
            last_seen: null,
            online: true,
            incoming_available: 0,
            outgoing_available: 0,
            outgoing_spent: 0,
            can_sign: false,
            can_ecdh: true,
            can_ping: true,
            should_send_nonces: false,
            last_response_latency_ms: 40,
            avg_latency_ms: 40,
            nonce_history: [],
          })),
          peer_permission_states: [],
          pending_operations: [],
        }),
      drain_runtime_events: () => '[]',
      drain_outbound_events: () => '[]',
      drain_completions: () => '[]',
      drain_failures: () => JSON.stringify(failures.splice(0)),
    };
  }

  test('marks a timed-out peer unavailable in the browser runtime status', async () => {
    vi.useFakeTimers();
    try {
      const peer = 'aa'.repeat(32);
      const node = new BrowserBridgeNode(baseConfig);
      const messages: unknown[] = [];
      node.on('message', (payload) => messages.push(payload));
      installRuntimeWithPeers(node, [peer]);

      const ping = node.pingPeer(peer);
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(ping).resolves.toEqual({ success: false, error: 'Ping timed out' });
      expect(node.runtimeStatus().peers[0]).toMatchObject({
        pubkey: peer,
        online: false,
        can_sign: false,
        can_ecdh: false,
        can_ping: false,
        last_response_latency_ms: null,
      });
      expect(messages).toContainEqual(
        expect.objectContaining({
          domain: 'ping',
          event: 'failure',
          message: 'Ping timed out',
          peer,
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test('matches runtime ping failures to failed_peer instead of queue order', async () => {
    vi.useFakeTimers();
    try {
      const firstPeer = 'aa'.repeat(32);
      const secondPeer = 'bb'.repeat(32);
      const failures: unknown[] = [];
      const node = new BrowserBridgeNode(baseConfig);
      const messages: unknown[] = [];
      node.on('message', (payload) => messages.push(payload));
      installRuntimeWithPeers(node, [firstPeer, secondPeer], failures);

      const firstPing = node.pingPeer(firstPeer);
      const secondPing = node.pingPeer(secondPeer);

      failures.push({
        request_id: 'ping-second',
        op_type: 'ping',
        code: 'timeout',
        message: 'locked peer response timeout',
        failed_peer: secondPeer,
      });
      (node as unknown as { pumpRuntime: (nowMs: number) => void }).pumpRuntime(Date.now());

      await expect(secondPing).resolves.toMatchObject({
        success: false,
        error: 'locked peer response timeout',
      });
      const status = node.runtimeStatus();
      expect(status.peers.find((peer) => peer.pubkey === firstPeer)).toMatchObject({
        online: true,
        can_ping: true,
      });
      expect(status.peers.find((peer) => peer.pubkey === secondPeer)).toMatchObject({
        online: false,
        can_ping: false,
      });
      expect(messages).toContainEqual(
        expect.objectContaining({
          domain: 'ping',
          event: 'failure',
          peer: secondPeer,
          failed_peer: secondPeer,
        }),
      );

      await vi.advanceTimersByTimeAsync(10_000);
      await expect(firstPing).resolves.toMatchObject({ success: false, error: 'Ping timed out' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('refreshRelayHealth', () => {
  // refreshRelayHealth is private and exercises probeRelayWebSocket + the relay
  // pool; inject fakes the way the other isolation tests reach internals.
  type Internals = {
    pool: { ensureRelay: (relay: string) => Promise<void> };
    activeRelays: string[];
    connectedRelays: Set<string>;
    probeRelayWebSocket: (relay: string) => Promise<void>;
    refreshRelayHealth: (opts?: { verbose?: boolean }) => Promise<boolean>;
  };

  function nodeWith(relays: string[], up: Set<string>) {
    const node = new BrowserBridgeNode({ mode: 'persisted', relays });
    const internals = node as unknown as Internals;
    internals.activeRelays = relays;
    internals.pool = {
      ensureRelay: (relay: string) =>
        up.has(relay) ? Promise.resolve() : Promise.reject(new Error('down')),
    };
    internals.probeRelayWebSocket = (relay: string) =>
      up.has(relay) ? Promise.resolve() : Promise.reject(new Error('probe failed'));
    return { node, internals };
  }

  test('recomputes the connected set and reports changes', async () => {
    const up = new Set(['wss://a', 'wss://b']);
    const { internals } = nodeWith(['wss://a', 'wss://b'], up);

    // First refresh: both up, set changes from empty → true.
    expect(await internals.refreshRelayHealth()).toBe(true);
    expect([...internals.connectedRelays].sort()).toEqual(['wss://a', 'wss://b']);

    // Idempotent refresh: nothing changed → false.
    expect(await internals.refreshRelayHealth()).toBe(false);

    // A relay drops: set shrinks → true, and reflects only the live relay.
    up.delete('wss://b');
    expect(await internals.refreshRelayHealth()).toBe(true);
    expect([...internals.connectedRelays]).toEqual(['wss://a']);

    // All relays drop → empty set (a valid all-relays-offline state, no throw).
    up.delete('wss://a');
    expect(await internals.refreshRelayHealth()).toBe(true);
    expect([...internals.connectedRelays]).toEqual([]);
  });
});

describe('relay-health visibility back-off', () => {
  // igloo-shared tests run in node (no DOM), so inject a minimal document to
  // drive the bridge's visibility handler directly.
  type VisInternals = {
    pool: object | null;
    relayHealthHandle: ReturnType<typeof setInterval> | null;
    refreshRelayHealth: () => Promise<boolean>;
    startRelayHealthProbe: () => void;
    stopRelayHealthProbe: () => void;
    onVisibilityChange: () => void;
  };

  test('pauses the re-probe when hidden and resumes when visible', async () => {
    const fakeDocument = { hidden: false } as { hidden: boolean };
    (globalThis as { document?: unknown }).document = fakeDocument;
    try {
      const node = new BrowserBridgeNode(baseConfig);
      const internals = node as unknown as VisInternals;
      internals.pool = {}; // mark "connected" so the handler acts
      internals.refreshRelayHealth = vi.fn().mockResolvedValue(false);

      internals.startRelayHealthProbe();
      expect(internals.relayHealthHandle).not.toBeNull();

      // Hidden → probe paused.
      fakeDocument.hidden = true;
      internals.onVisibilityChange();
      expect(internals.relayHealthHandle).toBeNull();

      // Visible again → probe restarted + an immediate refresh.
      fakeDocument.hidden = false;
      internals.onVisibilityChange();
      expect(internals.relayHealthHandle).not.toBeNull();
      expect(internals.refreshRelayHealth).toHaveBeenCalled();

      internals.stopRelayHealthProbe();
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });

  test('does nothing when not connected (no pool)', () => {
    const fakeDocument = { hidden: true } as { hidden: boolean };
    (globalThis as { document?: unknown }).document = fakeDocument;
    try {
      const node = new BrowserBridgeNode(baseConfig);
      const internals = node as unknown as VisInternals;
      internals.pool = null;
      internals.onVisibilityChange();
      expect(internals.relayHealthHandle).toBeNull();
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });
});

describe('bridge-command failure drain (R6.5)', () => {
  // `runBridgeCommand` registers a pending sign/ecdh op, then `pumpRuntime`
  // drains a matching failure from the runtime and must reject that pending
  // promise (a drained failure binds to the FIFO head of its kind — see
  // `matchBridgeCompletion`). These are the sign/ecdh reject paths that
  // `signNostrEvent` / `nip44Encrypt` / `nip44Decrypt` all funnel through.
  type CmdInternals = {
    runtime: unknown;
    pendingCommandState: {
      commands: Map<string, unknown>;
      kindFifo: { sign: string[]; ecdh: string[] };
    };
    runBridgeCommand: (
      kind: 'sign' | 'ecdh',
      command: Record<string, unknown>,
    ) => Promise<string>;
  };

  // A runtime whose drain surfaces exactly one failure for `opType`. The
  // request_id need not match the TS-side UUID — the failure binds to the
  // oldest pending op of its kind.
  function failingRuntime(opType: 'sign' | 'ecdh', message: string) {
    return {
      tick: () => {},
      handle_command: () => {},
      drain_runtime_events: () => '[]',
      drain_outbound_events: () => '[]',
      drain_completions: () => '[]',
      drain_failures: () =>
        JSON.stringify([{ op_type: opType, message, request_id: 'wasm-req-1' }]),
    };
  }

  test('a drained sign failure rejects the pending sign and clears pending state', async () => {
    const node = new BrowserBridgeNode(baseConfig);
    const internals = node as unknown as CmdInternals;
    internals.runtime = failingRuntime('sign', 'signer refused the request') as never;

    await expect(
      internals.runBridgeCommand('sign', { type: 'sign', message_hex_32: 'aa'.repeat(32) }),
    ).rejects.toThrow('signer refused the request');

    // No orphaned pending entry / FIFO tombstone left behind.
    expect(internals.pendingCommandState.commands.size).toBe(0);
    expect(internals.pendingCommandState.kindFifo.sign).toHaveLength(0);
  });

  test('a drained ecdh failure rejects the pending ecdh op', async () => {
    const node = new BrowserBridgeNode(baseConfig);
    const internals = node as unknown as CmdInternals;
    internals.runtime = failingRuntime('ecdh', 'ecdh peer unavailable') as never;

    await expect(
      internals.runBridgeCommand('ecdh', { type: 'ecdh', pubkey32_hex: 'bb'.repeat(32) }),
    ).rejects.toThrow('ecdh peer unavailable');
    expect(internals.pendingCommandState.commands.size).toBe(0);
    expect(internals.pendingCommandState.kindFifo.ecdh).toHaveLength(0);
  });
});

describe('NIP-44 adversarial wrapper coverage (C4)', () => {
  type Nip44Internals = {
    runtime: unknown;
    pendingCommandState: {
      commands: Map<string, unknown>;
      kindFifo: { sign: string[]; ecdh: string[] };
    };
  };

  function readyStatus() {
    return JSON.stringify({
      readiness: {
        sign_ready: true,
        ecdh_ready: true,
        restore_complete: true,
        last_refresh_at: Math.floor(Date.now() / 1000) + 60,
        degraded_reasons: [],
        threshold: 2,
        signing_peer_count: 2,
        ecdh_peer_count: 2,
      },
      peers: [],
      peer_permission_states: [],
    });
  }

  function nodeWithRuntime(runtime: unknown) {
    const node = new BrowserBridgeNode(baseConfig);
    const internals = node as unknown as Nip44Internals;
    internals.runtime = runtime;
    return { node, internals };
  }

  function ecdhFailureRuntime(message: string, handleCommand = vi.fn()) {
    return {
      tick: () => {},
      handle_command: handleCommand,
      runtime_status: readyStatus,
      drain_runtime_events: () => '[]',
      drain_outbound_events: () => '[]',
      drain_completions: () => '[]',
      drain_failures: () =>
        JSON.stringify([{ op_type: 'ecdh', message, request_id: 'wasm-ecdh-1' }]),
    };
  }

  function ecdhCompletionRuntime(sharedSecretHex32: string, handleCommand = vi.fn()) {
    return {
      tick: () => {},
      handle_command: handleCommand,
      runtime_status: readyStatus,
      drain_runtime_events: () => '[]',
      drain_outbound_events: () => '[]',
      drain_completions: () =>
        JSON.stringify([
          {
            Ecdh: {
              request_id: 'wasm-ecdh-1',
              shared_secret_hex32: sharedSecretHex32,
            },
          },
        ]),
      drain_failures: () => '[]',
    };
  }

  test('nip44Encrypt rejects non-string plaintext before issuing ECDH', async () => {
    const handleCommand = vi.fn();
    const { node } = nodeWithRuntime(ecdhFailureRuntime('should not run', handleCommand));

    await expect(
      node.nip44Encrypt('bb'.repeat(32), 5 as unknown as string),
    ).rejects.toThrow('NIP-44 plaintext must be a string');
    expect(handleCommand).not.toHaveBeenCalled();
  });

  test('nip44Decrypt rejects non-string ciphertext before issuing ECDH', async () => {
    const handleCommand = vi.fn();
    const { node } = nodeWithRuntime(ecdhFailureRuntime('should not run', handleCommand));

    await expect(
      node.nip44Decrypt('bb'.repeat(32), 5 as unknown as string),
    ).rejects.toThrow('NIP-44 ciphertext must be a string');
    expect(handleCommand).not.toHaveBeenCalled();
  });

  test('nip44Encrypt propagates drained ECDH failures and clears pending state', async () => {
    const { node, internals } = nodeWithRuntime(ecdhFailureRuntime('ecdh peer unavailable'));

    await expect(node.nip44Encrypt('bb'.repeat(32), 'hello')).rejects.toThrow(
      'ecdh peer unavailable',
    );
    expect(internals.pendingCommandState.commands.size).toBe(0);
    expect(internals.pendingCommandState.kindFifo.ecdh).toHaveLength(0);
  });

  test('nip44Decrypt propagates drained ECDH failures and clears pending state', async () => {
    const { node, internals } = nodeWithRuntime(ecdhFailureRuntime('ecdh peer unavailable'));

    await expect(node.nip44Decrypt('bb'.repeat(32), 'AAAA')).rejects.toThrow(
      'ecdh peer unavailable',
    );
    expect(internals.pendingCommandState.commands.size).toBe(0);
    expect(internals.pendingCommandState.kindFifo.ecdh).toHaveLength(0);
  });

  test('nip44Decrypt rejects malformed ciphertext after ECDH and clears pending state', async () => {
    const { node, internals } = nodeWithRuntime(ecdhCompletionRuntime('ab'.repeat(32)));

    await expect(node.nip44Decrypt('bb'.repeat(32), 'abc-def_invalid')).rejects.toThrow(
      Nip44NormalizeError,
    );
    expect(internals.pendingCommandState.commands.size).toBe(0);
    expect(internals.pendingCommandState.kindFifo.ecdh).toHaveLength(0);
  });
});

describe('signNostrEvent verification guard (R6.5)', () => {
  test('throws when the assembled event fails signature verification', async () => {
    const node = new BrowserBridgeNode(baseConfig);
    const internals = node as unknown as { runtime: unknown; groupPubkey32: string };

    // A valid x-only pubkey (the secp256k1 generator x-coord) so getPublicKey()
    // and getEventHash() succeed; the signature drained below is bogus, so
    // verifyEvent() must reject the assembled event.
    internals.groupPubkey32 =
      '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    const readyStatus = JSON.stringify({
      readiness: {
        sign_ready: true,
        ecdh_ready: true,
        restore_complete: true,
        last_refresh_at: Math.floor(Date.now() / 1000) + 60,
        degraded_reasons: [],
        threshold: 2,
        signing_peer_count: 2,
        ecdh_peer_count: 2,
      },
    });
    internals.runtime = {
      tick: () => {},
      handle_command: () => {},
      runtime_status: () => readyStatus,
      drain_runtime_events: () => '[]',
      drain_outbound_events: () => '[]',
      drain_completions: () =>
        JSON.stringify([
          { Sign: { request_id: 'wasm-sign-1', signatures_hex64: ['ab'.repeat(64)] } },
        ]),
      drain_failures: () => '[]',
    } as never;

    await expect(
      node.signNostrEvent({ kind: 1, content: 'hello', tags: [], created_at: 1700000000 }),
    ).rejects.toThrow('Signed event failed verification');
  });
});
