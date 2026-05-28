import { describe, expect, it } from 'vitest';

import { recoverSecretKeyFromShares, type BrowserRotationRecoveredSource } from './rotation';

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
