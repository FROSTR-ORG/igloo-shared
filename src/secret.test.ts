import { describe, expect, test } from 'vitest';

import { Secret, SecretBytes } from './secret';

describe('Secret<T>', () => {
  test('secret_jsonstringify_returns_redacted', () => {
    const s = Secret.of('super-sensitive-passphrase');
    expect(JSON.stringify(s)).toBe('"<redacted>"');
    expect(JSON.stringify({ p: s })).toBe('{"p":"<redacted>"}');
    expect(JSON.stringify({ nested: { p: s } })).toBe('{"nested":{"p":"<redacted>"}}');
  });

  test('secret_tostring_returns_redacted', () => {
    const s = Secret.of('hunter2');
    expect(String(s)).toBe('Secret(<redacted>)');
    expect(`${s}`).toBe('Secret(<redacted>)');
    expect(s.toString()).toBe('Secret(<redacted>)');
  });

  test('expose returns the wrapped value', () => {
    const s = Secret.of('opensesame');
    expect(s.expose()).toBe('opensesame');
  });

  test('nested stringification never reveals wrapped value', () => {
    const s = Secret.of('LEAK-MARKER-42');
    const serialized = JSON.stringify({
      deep: { wrapper: s, arr: [s, { nested: s }] },
    });
    expect(serialized).not.toContain('LEAK-MARKER-42');
  });
});

describe('SecretBytes', () => {
  test('secretbytes_wipe_zeroes_buffer', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const s = new SecretBytes(bytes);
    const before = s.expose();
    expect(Array.from(before)).toEqual([1, 2, 3, 4, 5]);
    expect(s.isWiped()).toBe(false);
    s.wipe();
    expect(s.isWiped()).toBe(true);
    // The previously exposed reference shares storage with the wrapper, so
    // the zero fill must be observable via that reference.
    expect(Array.from(before)).toEqual([0, 0, 0, 0, 0]);
  });

  test('secretbytes_expose_after_wipe_throws', () => {
    const s = new SecretBytes(new Uint8Array([9, 9, 9]));
    s.wipe();
    expect(() => s.expose()).toThrow(/already wiped/);
  });

  test('constructor copies input so wipe does not mutate caller buffer', () => {
    const source = new Uint8Array([7, 7, 7]);
    const s = new SecretBytes(source);
    s.wipe();
    expect(Array.from(source)).toEqual([7, 7, 7]);
  });

  test('fromHex parses lowercase and uppercase', () => {
    const s = SecretBytes.fromHex('deadBEEF');
    expect(Array.from(s.expose())).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  test('fromHex rejects non-hex input', () => {
    expect(() => SecretBytes.fromHex('zz')).toThrow();
  });

  test('toJSON and toString redact', () => {
    const s = new SecretBytes(new Uint8Array([1, 2, 3]));
    expect(JSON.stringify(s)).toBe('"<redacted>"');
    expect(JSON.stringify({ p: s })).toBe('{"p":"<redacted>"}');
    expect(String(s)).toBe('SecretBytes(<redacted>)');
  });

  test('wipe is idempotent', () => {
    const s = new SecretBytes(new Uint8Array([1, 2, 3]));
    s.wipe();
    s.wipe();
    expect(s.isWiped()).toBe(true);
  });
});
