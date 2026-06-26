import { beforeEach, describe, expect, it, vi } from 'vitest';

const { decodeBfProfilePackage, getWasmKeysetApi } = vi.hoisted(() => ({
  decodeBfProfilePackage: vi.fn(),
  getWasmKeysetApi: vi.fn(async () => ({
    derive_group_id: vi.fn(() => 'aa'.repeat(32)),
  })),
}));

vi.mock('./profile-package', async () => {
  const actual = await vi.importActual<typeof import('./profile-package')>('./profile-package');
  return {
    ...actual,
    decodeBfProfilePackage,
  };
});

vi.mock('./bridge-wasm-runtime', async () => {
  const actual = await vi.importActual<typeof import('./bridge-wasm-runtime')>('./bridge-wasm-runtime');
  return {
    ...actual,
    getWasmKeysetApi,
  };
});

import {
  recoverRotationSourceFromPackage,
  recoverSecretKeyFromShares,
  type BrowserRotationRecoveredSource,
} from './rotation';

// Minimal partial fixture: the recovery guards (empty / below-threshold / mismatched
// group) all throw before any wasm call, so only groupId + threshold are needed.
function source(groupId: string, threshold: number): BrowserRotationRecoveredSource {
  return {
    groupId,
    profile: {
      groupPackage: { groupName: 'Group', groupPk: groupId, threshold, members: [] },
    },
  } as unknown as BrowserRotationRecoveredSource;
}

const profilePayload = {
  profileId: 'profile-1',
  version: 1,
  device: {
    name: 'Device 1',
    shareSecret: '11'.repeat(32),
    manualPeerPolicyOverrides: [],
    relays: [' wss://relay.example '],
  },
  groupPackage: {
    groupName: 'Group',
    groupPk: '22'.repeat(32),
    threshold: 2,
    members: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  decodeBfProfilePackage.mockResolvedValue(profilePayload);
});

describe('recoverSecretKeyFromShares validation guards', () => {
  it('rejects an empty source set', async () => {
    await expect(recoverSecretKeyFromShares({ sources: [] })).rejects.toThrow(
      /at least one share/i,
    );
  });

  it('rejects fewer shares than the threshold', async () => {
    await expect(
      recoverSecretKeyFromShares({ sources: [source('group-a', 2)] }),
    ).rejects.toThrow(/at least 2 shares/i);
  });

  it('rejects sources from different groups', async () => {
    await expect(
      recoverSecretKeyFromShares({
        sources: [source('group-a', 2), source('group-b', 2)],
      }),
    ).rejects.toThrow(/same group/i);
  });
});

describe('recoverRotationSourceFromPackage', () => {
  it('accepts bfprofile source packages without requiring relay backup recovery', async () => {
    const source = await recoverRotationSourceFromPackage('  bfprofile1source  ', 'profile-pass');

    expect(decodeBfProfilePackage).toHaveBeenCalledWith('bfprofile1source', 'profile-pass');
    expect(source.sourcePackageKind).toBe('bfprofile');
    expect(source.share).toEqual({
      shareSecret: '11'.repeat(32),
      relays: ['wss://relay.example'],
    });
    expect(source.profile.device.relays).toEqual(['wss://relay.example']);
    expect(source.backup).toBeNull();
    expect(source.event).toBeNull();
    expect(source.groupId).toBe('aa'.repeat(32));
  });

  it('rejects bfonboard packages as adoption packages', async () => {
    await expect(
      recoverRotationSourceFromPackage('bfonboard1demo', 'onboard-pass'),
    ).rejects.toThrow(/adoption packages/i);
  });
});
