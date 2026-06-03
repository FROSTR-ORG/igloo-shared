import { describe, expect, test } from 'vitest';

import { DEFAULT_RELAYS, isRelayUrl, normalizeRelays } from './relay-transport';

// PR-I4 (R3 / Bucket I): relay-transport.ts is the pure, side-effect-free slice
// of the post-G.2 split (the connection lifecycle lives on BrowserBridgeNode);
// these helpers had no direct coverage.

describe('isRelayUrl', () => {
  test('accepts ws/wss URLs with a host', () => {
    expect(isRelayUrl('wss://relay.example.com')).toBe(true);
    expect(isRelayUrl('ws://localhost:8080')).toBe(true);
    expect(isRelayUrl('wss://a')).toBe(true);
  });

  test('rejects non-ws schemes, bare hosts, and empty input', () => {
    expect(isRelayUrl('http://relay.example.com')).toBe(false);
    expect(isRelayUrl('relay.example.com')).toBe(false);
    expect(isRelayUrl('')).toBe(false);
    expect(isRelayUrl('wss://')).toBe(false);
  });
});

describe('normalizeRelays', () => {
  test('trims, strips trailing slashes, and de-duplicates', () => {
    const { relays, errors } = normalizeRelays(['  wss://a  ', 'wss://a/', 'wss://b']);
    expect(relays).toEqual(['wss://a', 'wss://b']);
    expect(errors).toEqual([]);
  });

  test('separates invalid URLs into errors while keeping the valid ones', () => {
    const { relays, errors } = normalizeRelays(['wss://good', 'http://bad']);
    expect(relays).toEqual(['wss://good']);
    expect(errors).toEqual(['Invalid relay URL: http://bad']);
  });

  test('falls back to DEFAULT_RELAYS when no valid relay remains', () => {
    const { relays, errors } = normalizeRelays(['http://bad', 'nope']);
    expect(relays).toEqual(DEFAULT_RELAYS);
    expect(errors).toHaveLength(2);
  });

  test('ignores empty and whitespace-only entries, falling back to defaults', () => {
    const { relays, errors } = normalizeRelays(['', '   ']);
    expect(relays).toEqual(DEFAULT_RELAYS);
    expect(errors).toEqual([]);
  });
});
