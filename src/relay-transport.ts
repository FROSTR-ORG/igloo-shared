// Relay-URL normalization helpers.
//
// PR30: relay-URL validation and normalization moved verbatim out of
// `browser-runtime-core.ts`. The relay/SimplePool connection lifecycle
// (probe/connect/subscribe/publish) lives on `BrowserBridgeNode` in
// `wasm-bridge-node.ts`; the standalone, side-effect-free relay helpers
// live here so they can be shared and unit-tested independently.

import { DEFAULT_RELAYS } from './runtime-internal';

export { DEFAULT_RELAYS };

const ensureArray = (value: string[]) =>
  Array.from(new Set(value.map((relay) => relay.replace(/\/$/, ''))));

export function isRelayUrl(value: string): boolean {
  return /^wss?:\/\/.+/.test(value);
}

export function normalizeRelays(relays: string[]): { relays: string[]; errors: string[] } {
  const base = relays.filter((relay) => typeof relay === 'string' && relay.trim().length > 0);
  const normalized = ensureArray(base.map((relay) => relay.trim()));

  const valid = normalized.filter(isRelayUrl);
  const errors = normalized
    .filter((relay) => !isRelayUrl(relay))
    .map((relay) => `Invalid relay URL: ${relay}`);

  return {
    relays: valid.length ? valid : DEFAULT_RELAYS,
    errors
  };
}
