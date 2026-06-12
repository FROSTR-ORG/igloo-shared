import { describe, expect, it } from 'vitest';

import { publicKeyFromSecret } from './browser-profile/core';
import type { BrowserGroupPackage } from './profile-package';
import { recoverSecretKeyFromShares } from './rotation';

const secretA = '11'.repeat(32);
const secretB = '22'.repeat(32);

// The recovery guards (below-threshold / wrong-keyset) throw before any wasm call,
// so a group package with members keyed off real share pubkeys is enough.
function group(threshold: number, memberSecrets: string[]): BrowserGroupPackage {
  return {
    groupName: 'Group',
    groupPk: `02${publicKeyFromSecret(secretA)}`,
    threshold,
    members: memberSecrets.map((secret, index) => ({
      idx: index + 1,
      pubkey: `02${publicKeyFromSecret(secret)}`,
    })),
  };
}

describe('recoverSecretKeyFromShares validation guards', () => {
  it('rejects fewer distinct shares than the threshold', async () => {
    await expect(
      recoverSecretKeyFromShares({ groupPackage: group(2, [secretA, secretB]), shareSecrets: [secretA] }),
    ).rejects.toThrow(/at least 2 shares/i);
  });

  it('rejects a share that does not belong to the keyset', async () => {
    await expect(
      recoverSecretKeyFromShares({ groupPackage: group(2, [secretA]), shareSecrets: [secretB] }),
    ).rejects.toThrow(/does not belong/i);
  });
});
