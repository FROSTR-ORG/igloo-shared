/**
 * NIP-44 payload normalization helpers.
 *
 * The JS reference implementation (`nip44.v2.decrypt`) expects a
 * strictly-padded base64 string drawn from the canonical alphabet. The Rust
 * side, in contrast, prefers an unpadded base64url-compatible string.
 *
 * Before decrypt, we enforce:
 *
 * 1. A bounded payload length. `MAX_NIP44_PAYLOAD_LEN` aligns with
 *    bifrost-codec's `MAX_BRIDGE_ENVELOPE_BYTES` cap (64 KiB). Base64
 *    encoding inflates the size by roughly 4/3, so a 64 KiB envelope
 *    becomes ~88 KiB of base64. We round up to 100_000 for a small amount
 *    of comfort without materially enlarging the attack surface.
 *
 * 2. A strict base64 alphabet (`A-Z`, `a-z`, `0-9`, `+`, `/`, with zero or
 *    more trailing `=` padding characters). Non-alphabet bytes (including
 *    base64url's `-` and `_`) are rejected up front so the underlying
 *    decrypt path never sees malformed input.
 *
 * Rejecting input before calling `nip44.v2.decrypt` makes the failure mode
 * observable (via a typed `Nip44NormalizeError`) and avoids paying the
 * cost of a decrypt attempt on obviously-bogus ciphertext.
 */

/**
 * Maximum accepted length of a NIP-44 base64 payload before normalization.
 *
 * Chosen to be a small comfortable overshoot of the base64 expansion of
 * bifrost-codec's `MAX_BRIDGE_ENVELOPE_BYTES = 65_536` plaintext cap. A
 * 64 KiB plaintext encodes to ~87_384 base64 characters; 100_000 gives
 * headroom for NIP-44 framing overhead without allowing unbounded input.
 */
export const MAX_NIP44_PAYLOAD_LEN = 100_000;

const BASE64_ALPHABET = /^[A-Za-z0-9+/]+=*$/;

export type Nip44NormalizeReason =
  | 'payload_too_long'
  | 'payload_empty'
  | 'invalid_base64';

export class Nip44NormalizeError extends Error {
  readonly reason: Nip44NormalizeReason;
  readonly payloadLength: number;

  constructor(reason: Nip44NormalizeReason, payloadLength: number) {
    super(`nip44_normalize_${reason}`);
    this.name = 'Nip44NormalizeError';
    this.reason = reason;
    this.payloadLength = payloadLength;
  }
}

/**
 * Normalize a NIP-44 ciphertext blob for the JS decrypt path.
 *
 * Trims surrounding whitespace, validates length and alphabet, then adds
 * canonical `=` padding to a multiple of four characters. Throws
 * `Nip44NormalizeError` on invalid input.
 */
export function normalizeNip44PayloadForJs(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Nip44NormalizeError('payload_empty', 0);
  }
  if (trimmed.length > MAX_NIP44_PAYLOAD_LEN) {
    throw new Nip44NormalizeError('payload_too_long', trimmed.length);
  }
  if (!BASE64_ALPHABET.test(trimmed)) {
    throw new Nip44NormalizeError('invalid_base64', trimmed.length);
  }
  const mod = trimmed.length % 4;
  if (mod === 0) return trimmed;
  return `${trimmed}${'='.repeat(4 - mod)}`;
}

export function normalizeNip44PayloadForRust(value: string): string {
  return value.trim().replace(/=+$/g, '');
}
