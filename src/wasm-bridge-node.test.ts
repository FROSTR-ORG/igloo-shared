import { beforeEach, describe, expect, test, vi } from 'vitest';

import { BrowserBridgeNode } from './wasm-bridge-node';
import {
  resetWasmBridgeLoaderConfig,
  setInjectedWasmBridgeModuleForTests,
} from './bridge-wasm-runtime';
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
