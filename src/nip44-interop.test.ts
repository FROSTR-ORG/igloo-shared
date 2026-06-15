import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';

import { deriveConversationKeyFromSharedSecret } from './runtime-internal';

// FROSTR's app-facing NIP-44 (`window.nostr.nip44.*` → nip44Encrypt →
// deriveConversationKeyFromSharedSecret) must interoperate with standard nostr
// clients. nostr-tools IS the standard client here — every NIP-44 app derives the
// conversation key via `nip44.v2.utils.getConversationKey` and ciphers with
// `nip44.v2`.
//
// The conversation-key IKM is the bifrost-core threshold-ECDH secret, which is now
// the raw X-coordinate of the combined point (combine_ecdh_packages) — the standard
// NIP-44 shared secret. The combined threshold point equals the point a normal ECDH
// produces, so this 2-party / threshold-1 replication is faithful for any threshold.
// (Regression guard: this used to be SHA256(point), which broke interop.)
function frostrSharedSecretHex(privA: Uint8Array, pubBxonly: string): string {
  // Raw X-coordinate of the ECDH point (drop the SEC1 0x02 prefix) — what the fixed
  // combine_ecdh_packages returns and what standard NIP-44 feeds to HKDF-Extract.
  const rawX = secp256k1.getSharedSecret(privA, hexToBytes(`02${pubBxonly}`)).subarray(1, 33);
  return bytesToHex(rawX);
}

describe('NIP-44 interop: FROSTR app-facing path vs a standard nostr client', () => {
  it('sanity check: standard client <-> standard client round-trips', () => {
    const privA = generateSecretKey();
    const privB = generateSecretKey();
    const aKey = nip44.v2.utils.getConversationKey(privA, getPublicKey(privB));
    const bKey = nip44.v2.utils.getConversationKey(privB, getPublicKey(privA));
    const ciphertext = nip44.v2.encrypt('gm', aKey);
    expect(nip44.v2.decrypt(ciphertext, bKey)).toBe('gm');
  });

  it("FROSTR's conversation key equals the standard one for the same pair", async () => {
    const privA = generateSecretKey();
    const pubB = getPublicKey(generateSecretKey());

    const standardKey = nip44.v2.utils.getConversationKey(privA, pubB);
    const frostrKey = await deriveConversationKeyFromSharedSecret(frostrSharedSecretHex(privA, pubB));

    expect(bytesToHex(frostrKey)).toBe(bytesToHex(standardKey));
  });

  it('a standard nostr client CAN decrypt a message FROSTR encrypted', async () => {
    const privA = generateSecretKey(); // FROSTR group key (threshold-1 stand-in)
    const privB = generateSecretKey(); // a normal nostr user
    const pubA = getPublicKey(privA);
    const pubB = getPublicKey(privB);

    // FROSTR encrypts to Bob: its conversation key + the standard cipher
    // (exactly nip44Encrypt's `nip44.v2.encrypt(plaintext, conversationKey)`).
    const frostrKey = await deriveConversationKeyFromSharedSecret(frostrSharedSecretHex(privA, pubB));
    const ciphertext = nip44.v2.encrypt('gm from a frostr signer', frostrKey);

    // Bob derives the conversation key the standard way and decrypts.
    const bobKey = nip44.v2.utils.getConversationKey(privB, pubA);
    expect(nip44.v2.decrypt(ciphertext, bobKey)).toBe('gm from a frostr signer');
  });

  it('FROSTR CAN decrypt a message a standard nostr client encrypted', async () => {
    const privA = generateSecretKey();
    const privB = generateSecretKey();
    const pubA = getPublicKey(privA);
    const pubB = getPublicKey(privB);

    const bobKey = nip44.v2.utils.getConversationKey(privB, pubA);
    const ciphertext = nip44.v2.encrypt('gm from a normal client', bobKey);

    const frostrKey = await deriveConversationKeyFromSharedSecret(frostrSharedSecretHex(privA, pubB));
    expect(nip44.v2.decrypt(ciphertext, frostrKey)).toBe('gm from a normal client');
  });
});
