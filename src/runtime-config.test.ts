import { describe, expect, test } from 'vitest';

import { buildRuntimeDeviceConfig } from './runtime-config';

describe('buildRuntimeDeviceConfig', () => {
  test('maps normalized signer settings into the runtime device config', () => {
    expect(
      buildRuntimeDeviceConfig({
        sign_timeout_secs: 45,
        ping_timeout_secs: 10,
        request_ttl_secs: 600,
        state_save_interval_secs: 12,
        peer_selection_strategy: 'random',
      }),
    ).toEqual({
      device: {
        sign_timeout_secs: 45,
        ecdh_timeout_secs: 30,
        ping_timeout_secs: 10,
        onboard_timeout_secs: 30,
        request_ttl_secs: 600,
        max_future_skew_secs: 30,
        request_cache_limit: 2048,
        ecdh_cache_capacity: 256,
        ecdh_cache_ttl_secs: 300,
        sig_cache_capacity: 256,
        sig_cache_ttl_secs: 120,
        state_save_interval_secs: 12,
        event_kind: 20000,
        peer_selection_strategy: 'random',
      },
    });
  });

  test('applies signer-setting defaults and fallback normalization', () => {
    expect(
      buildRuntimeDeviceConfig({
        sign_timeout_secs: -1,
        ping_timeout_secs: 0,
        request_ttl_secs: Number.NaN,
        peer_selection_strategy: 'deterministic_sorted',
      }),
    ).toMatchObject({
      device: {
        sign_timeout_secs: 30,
        ping_timeout_secs: 15,
        request_ttl_secs: 300,
        state_save_interval_secs: 30,
        peer_selection_strategy: 'deterministic_sorted',
      },
    });
  });
});
