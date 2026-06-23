import { BIFROST_EVENT_KIND } from './runtime-internal';
import { normalizeSignerSettings, type SignerSettings } from './signer-settings';

export type RuntimeDeviceConfig = {
  device: {
    sign_timeout_secs: number;
    ecdh_timeout_secs: number;
    ping_timeout_secs: number;
    onboard_timeout_secs: number;
    request_ttl_secs: number;
    max_future_skew_secs: number;
    request_cache_limit: number;
    ecdh_cache_capacity: number;
    ecdh_cache_ttl_secs: number;
    sig_cache_capacity: number;
    sig_cache_ttl_secs: number;
    state_save_interval_secs: number;
    event_kind: number;
    peer_selection_strategy: SignerSettings['peer_selection_strategy'];
  };
};

export function buildRuntimeDeviceConfig(
  settings?: Partial<SignerSettings> | null,
): RuntimeDeviceConfig {
  const signerSettings = normalizeSignerSettings(settings);
  // Fields read from signerSettings are operator-tunable; the bare numeric
  // literals below are host-fixed runtime tuning not exposed in settings.
  return {
    device: {
      sign_timeout_secs: signerSettings.sign_timeout_secs,
      ecdh_timeout_secs: 30,
      ping_timeout_secs: signerSettings.ping_timeout_secs,
      onboard_timeout_secs: 30,
      request_ttl_secs: signerSettings.request_ttl_secs,
      max_future_skew_secs: 30,
      request_cache_limit: 2048,
      ecdh_cache_capacity: 256,
      ecdh_cache_ttl_secs: 300,
      sig_cache_capacity: 256,
      sig_cache_ttl_secs: 120,
      state_save_interval_secs: signerSettings.state_save_interval_secs,
      event_kind: BIFROST_EVENT_KIND,
      peer_selection_strategy: signerSettings.peer_selection_strategy,
    },
  };
}
