import { describe, expect, it } from 'vitest';
import { getPublicKey } from 'nostr-tools';
import { sharePubkeyFromSeckeyHex, normalizePubkey32Hex, hexToBytes } from './runtime-internal';

describe('sharePubkeyFromSeckeyHex', () => {
  it('derives the same normalized share pubkey as the direct path', () => {
    const seckeyHex = '11'.repeat(32);
    const expected = normalizePubkey32Hex(getPublicKey(hexToBytes(seckeyHex)), 'share public key');
    expect(sharePubkeyFromSeckeyHex(seckeyHex)).toBe(expected);
  });

  it('rejects an invalid seckey hex', () => {
    expect(() => sharePubkeyFromSeckeyHex('zz')).toThrow();
  });
});
