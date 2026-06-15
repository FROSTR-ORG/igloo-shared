import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';

import { deriveConversationKeyFromSharedSecret } from './runtime-internal';
import { normalizeNip44PayloadForRust } from './nip44-normalize';

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

  // Wire-format regression: the app-facing `nip44Encrypt` (wasm-bridge-node.ts)
  // must return standard, canonically-padded base64 — exactly `nip44.v2.encrypt`'s
  // output. It previously applied `normalizeNip44PayloadForRust`, which strips the
  // `=` padding; strict standard decoders (nostr-tools / @scure/base) then reject
  // it, so FROSTR ciphertext was undecryptable by a standard client even with the
  // correct conversation key. These two cases lock that contract.
  it('app-facing ciphertext is standard padded base64 a standard client decodes as-is', async () => {
    const privA = generateSecretKey();
    const pubB = getPublicKey(generateSecretKey());
    const frostrKey = await deriveConversationKeyFromSharedSecret(frostrSharedSecretHex(privA, pubB));

    const ciphertext = nip44.v2.encrypt('gm', frostrKey);
    expect(ciphertext.length % 4).toBe(0); // canonical base64 padding
    expect(nip44.v2.decrypt(ciphertext, frostrKey)).toBe('gm'); // decodes without re-padding
  });

  it('stripping base64 padding (the old normalizeNip44PayloadForRust) breaks standard decrypt', async () => {
    const privA = generateSecretKey();
    const pubB = getPublicKey(generateSecretKey());
    const frostrKey = await deriveConversationKeyFromSharedSecret(frostrSharedSecretHex(privA, pubB));

    // Pick a plaintext whose NIP-44 payload actually carries base64 `=` padding
    // (it depends on payload-byte-length mod 3): a 33-char message pads to a
    // 131-byte payload → a trailing `=`. The guard below keeps this honest.
    const padded = nip44.v2.encrypt('x'.repeat(33), frostrKey);
    expect(padded.endsWith('=')).toBe(true);
    const stripped = normalizeNip44PayloadForRust(padded);
    expect(stripped).not.toBe(padded);
    expect(() => nip44.v2.decrypt(stripped, frostrKey)).toThrow();
  });
});
