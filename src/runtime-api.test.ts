import { describe, expect, test, vi } from 'vitest';

import {
  createSignerNode,
  getRuntimeReadiness,
  getRuntimeSnapshot,
  getRuntimeStatus,
  validateOnboardCredential,
  validateOnboardingPassword,
} from './runtime-api';
import { BrowserBridgeNode } from './wasm-bridge-node';

// PR-I4 (R3 / Bucket I): runtime-api.ts is the public free-function facade over
// BrowserBridgeNode. Construction and the read-model delegations had no coverage.

describe('createSignerNode', () => {
  test('constructs a BrowserBridgeNode from a RuntimeConfig', () => {
    const node = createSignerNode({ mode: 'persisted', relays: [] });
    expect(node).toBeInstanceOf(BrowserBridgeNode);
  });
});

describe('runtime read-model delegations', () => {
  test('getRuntimeStatus / getRuntimeSnapshot / getRuntimeReadiness forward to the node', () => {
    const status = { peers: [], readiness: { runtime_ready: true } };
    const snapshot = { snap: 1 };
    const readiness = { runtime_ready: true };
    const node = {
      runtimeStatus: vi.fn(() => status),
      snapshotRuntimeState: vi.fn(() => snapshot),
      runtimeReadiness: vi.fn(() => readiness),
    } as unknown as BrowserBridgeNode;

    expect(getRuntimeStatus(node)).toBe(status);
    expect(getRuntimeSnapshot(node)).toBe(snapshot);
    expect(getRuntimeReadiness(node)).toBe(readiness);
    expect(node.runtimeStatus).toHaveBeenCalledOnce();
    expect(node.snapshotRuntimeState).toHaveBeenCalledOnce();
    expect(node.runtimeReadiness).toHaveBeenCalledOnce();
  });
});

describe('validateOnboardingPassword', () => {
  test('requires a non-empty password of at least 8 characters', () => {
    expect(validateOnboardingPassword('')).toEqual({
      isValid: false,
      error: 'Password is required',
    });
    expect(validateOnboardingPassword('short')).toEqual({
      isValid: false,
      error: 'Password must be at least 8 characters',
    });
    expect(validateOnboardingPassword('longenough')).toEqual({ isValid: true });
  });
});

describe('validateOnboardCredential', () => {
  test('requires a sufficiently long bfonboard1 bech32m string', () => {
    expect(validateOnboardCredential('')).toMatchObject({ isValid: false });
    expect(validateOnboardCredential('not-a-package')).toMatchObject({
      error: 'Onboarding package must start with bfonboard1',
    });
    expect(validateOnboardCredential('bfonboard1!!!notbech32')).toMatchObject({
      error: 'Onboarding package must be valid bech32m text',
    });
    expect(validateOnboardCredential('bfonboard1ac')).toMatchObject({
      error: 'Onboarding package is too short',
    });
    expect(validateOnboardCredential(`bfonboard1${'a'.repeat(40)}`)).toEqual({ isValid: true });
  });
});
