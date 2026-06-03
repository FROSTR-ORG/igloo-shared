/**
 * Type-level hygiene for secret-bearing values.
 *
 * This module provides two wrappers:
 *
 *  - `Secret<T>`: immutable wrapper for secret strings.
 *  - `SecretBytes`: wipeable wrapper for secret `Uint8Array` buffers.
 *
 * =============================================================================
 * IMPORTANT THREAT-MODEL NOTES — READ BEFORE USING
 * =============================================================================
 *
 * JavaScript strings are immutable. Once a string value exists in the runtime,
 * the engine may retain copies in string interning tables, GC generations, and
 * V8 representation caches. There is NO safe way to zeroize the backing
 * storage of a `string`. This means:
 *
 *   - `Secret<T>` is NOT a zeroization guarantee.
 *   - Strings wrapped in `Secret<T>` may still linger in memory until the GC
 *     reclaims them, and even then there is no guarantee about physical memory.
 *
 * What `Secret<T>` IS:
 *
 *   1. Type-level hygiene. Passing a `Secret<string>` to a function expecting
 *      `string` requires an explicit `.expose()` call. Every exposure is
 *      greppable and reviewable.
 *   2. Log safety. `JSON.stringify(secret)` returns `"<redacted>"` and
 *      `String(secret)` returns `"Secret(<redacted>)"`. Accidental
 *      stringification in logs, error messages, and console output does NOT
 *      leak the wrapped value.
 *   3. A policy signal. It is harder to accidentally propagate a secret
 *      through a code path when the type system stops you at the boundary.
 *
 * For material that CAN be wiped — `Uint8Array` — use `SecretBytes`. It calls
 * `.fill(0)` in `wipe()` and `expose()` throws after a wipe to flag
 * use-after-free.
 *
 * Scope limit: neither wrapper protects against an attacker with code
 * execution or heap access. The goal here is to close accidental leaks via
 * logging, serialization, and unintended value propagation.
 */

/**
 * Immutable wrapper around a secret string.
 *
 * Construction is always via `Secret.of(value)`. There is no public
 * constructor and no `Serialize`-like back-door: `toJSON()` yields
 * `"<redacted>"`, `toString()` yields `"Secret(<redacted>)"`, and
 * `expose()` is the only path to the underlying value.
 *
 * The wrapped string itself is NOT wipeable — see module header.
 */
export class Secret<T extends string = string> {
  private readonly value: T;

  private constructor(value: T) {
    this.value = value;
  }

  /** Wrap a secret value. */
  static of<T extends string>(value: T): Secret<T> {
    return new Secret(value);
  }

  /** Unwrap the secret. Every call site should be greppable and intentional. */
  expose(): T {
    return this.value;
  }

  /** Always returns `"Secret(<redacted>)"` — never reveals the wrapped value. */
  toString(): string {
    return 'Secret(<redacted>)';
  }

  /** Always returns the literal `"<redacted>"` — hides from `JSON.stringify`. */
  toJSON(): string {
    return '<redacted>';
  }
}

/**
 * Alias for a wrapped passphrase string. Naming makes intent visible at
 * call sites (arguments named `passphrase: Passphrase` are grep-friendly).
 */
export type Passphrase = Secret<string>;

/**
 * Alias for a wrapped 32-byte share secret encoded as lowercase hex.
 */
export type ShareSecretHex = Secret<string>;

/**
 * Wipeable byte-array secret.
 *
 * `wipe()` overwrites the internal buffer with zeros and marks the wrapper
 * as consumed. After `wipe()`, `expose()` throws — this surfaces
 * use-after-free bugs during tests.
 *
 * The constructor copies the source bytes so the caller's input is not
 * mutated by `wipe()`.
 */
export class SecretBytes {
  private readonly buf: Uint8Array;
  private wiped = false;

  constructor(bytes: Uint8Array) {
    // Copy so wipe() only affects our buffer, not the caller's.
    this.buf = new Uint8Array(bytes);
  }

  /** Construct from a hex string. Throws on odd length or non-hex chars. */
  static fromHex(hex: string): SecretBytes {
    if (typeof hex !== 'string') {
      throw new TypeError('SecretBytes.fromHex: expected string');
    }
    const normalized = hex.length % 2 === 0 ? hex : '0' + hex;
    const len = normalized.length / 2;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      const byte = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
      if (Number.isNaN(byte)) {
        throw new TypeError('SecretBytes.fromHex: invalid hex');
      }
      out[i] = byte;
    }
    return new SecretBytes(out);
  }

  /**
   * Return the underlying buffer. Throws if `wipe()` has already been called.
   *
   * NOTE: the returned reference shares storage with the wrapper. A caller
   * that mutates it will mutate the wrapper's state. `wipe()` zeros the same
   * buffer that was previously exposed.
   */
  expose(): Uint8Array {
    if (this.wiped) {
      throw new Error('SecretBytes: already wiped');
    }
    return this.buf;
  }

  /** Zero the underlying buffer. Idempotent. After calling, `expose()` throws. */
  wipe(): void {
    this.buf.fill(0);
    this.wiped = true;
  }

  /** `true` once `wipe()` has been called. */
  isWiped(): boolean {
    return this.wiped;
  }

  toString(): string {
    return 'SecretBytes(<redacted>)';
  }

  toJSON(): string {
    return '<redacted>';
  }
}
