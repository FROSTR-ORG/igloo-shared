import { beforeEach, describe, expect, it, vi } from 'vitest';

import { publicKeyFromSecret } from './browser-profile/core';
import type { BrowserGroupPackage } from './profile-package';
import { Secret } from './secret';
import { buildRotationDraft, recoverSecretKeyFromShares } from './rotation';

const mockKeysetApi = vi.hoisted(() => ({
  rotate_keyset_bundle: vi.fn(),
  recover_secret_key_from_shares: vi.fn(),
}));

vi.mock('./bridge-wasm-runtime', () => ({
  getWasmKeysetApi: vi.fn(async () => mockKeysetApi),
}));

const secretA = '11'.repeat(32);
const secretB = '22'.repeat(32);
const rotatedSecret = '44'.repeat(32);
const recoveredSigningKey = 'aa'.repeat(32);
const groupPublicKey = '99'.repeat(32);
const sourceGroupId = '77'.repeat(32);
const nextGroupId = '88'.repeat(32);

function group(threshold: number, memberSecrets: string[]): BrowserGroupPackage {
  return {
    groupName: 'Group',
    groupPk: groupPublicKey,
    threshold,
    members: memberSecrets.map((secret, index) => ({
      idx: index + 1,
      pubkey: `02${publicKeyFromSecret(secret)}`,
    })),
  };
}

describe('rotation secret discipline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKeysetApi.rotate_keyset_bundle.mockReturnValue(
      JSON.stringify({
        previous_group_id: sourceGroupId,
        next_group_id: nextGroupId,
        next: {
          group: {
            group_pk: groupPublicKey,
            threshold: 1,
            members: [{ idx: 1, pubkey: `02${publicKeyFromSecret(rotatedSecret)}` }],
          },
          shares: [{ idx: 1, seckey: rotatedSecret }],
        },
      }),
    );
    mockKeysetApi.recover_secret_key_from_shares.mockReturnValue(recoveredSigningKey);
  });

  it('returns rotated share secrets as redacting Secret wrappers', async () => {
    const draft = await buildRotationDraft({
      groupPackage: group(1, [secretA]),
      shareSecrets: [Secret.of(secretA)],
      threshold: 1,
      count: 1,
      groupName: 'Rotated Group',
    });

    expect(draft.shares[0].shareSecret.expose()).toBe(rotatedSecret);
    expect(JSON.stringify(draft.shares[0].shareSecret)).toBe('"<redacted>"');
    expect(JSON.stringify(draft)).not.toContain(rotatedSecret);
    expect(draft.shares[0].sharePublicKey).toBe(publicKeyFromSecret(rotatedSecret));

    const payload = JSON.parse(mockKeysetApi.rotate_keyset_bundle.mock.calls[0][0]);
    expect(typeof payload.shares[0].seckey).toBe('string');
    expect(payload.shares[0].seckey).toBe(secretA);
    expect(payload.shares[0].seckey).not.toBe('<redacted>');
  });

  it('returns recovered keys as redacting Secret wrappers', async () => {
    const recovered = await recoverSecretKeyFromShares({
      groupPackage: group(1, [secretA]),
      shareSecrets: [Secret.of(secretA)],
    });

    expect(recovered.signingKeyHex.expose()).toBe(recoveredSigningKey);
    expect(recovered.nsec.expose()).toMatch(/^nsec1/);
    expect(JSON.stringify(recovered)).toBe('{"nsec":"<redacted>","signingKeyHex":"<redacted>"}');
    expect(JSON.stringify(recovered)).not.toContain(recoveredSigningKey);

    const payload = JSON.parse(mockKeysetApi.recover_secret_key_from_shares.mock.calls[0][0]);
    expect(typeof payload.shares[0].seckey).toBe('string');
    expect(payload.shares[0].seckey).toBe(secretA);
    expect(payload.shares[0].seckey).not.toBe('<redacted>');
  });
});

describe('recoverSecretKeyFromShares validation guards', () => {
  it('rejects fewer distinct shares than the threshold', async () => {
    await expect(
      recoverSecretKeyFromShares({
        groupPackage: group(2, [secretA, secretB]),
        shareSecrets: [Secret.of(secretA)],
      }),
    ).rejects.toThrow(/at least 2 shares/i);
  });

  it('rejects a share that does not belong to the keyset', async () => {
    await expect(
      recoverSecretKeyFromShares({
        groupPackage: group(2, [secretA]),
        shareSecrets: [Secret.of(secretB)],
      }),
    ).rejects.toThrow(/does not belong/i);
  });
});
