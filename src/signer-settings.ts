export type PeerSelectionStrategy = 'deterministic_sorted' | 'random';

export type SignerSettings = {
  sign_timeout_secs: number;
  ping_timeout_secs: number;
  request_ttl_secs: number;
  state_save_interval_secs: number;
  peer_selection_strategy: PeerSelectionStrategy;
};

export const DEFAULT_SIGNER_SETTINGS: SignerSettings = {
  sign_timeout_secs: 30,
  ping_timeout_secs: 15,
  request_ttl_secs: 300,
  state_save_interval_secs: 30,
  peer_selection_strategy: 'deterministic_sorted'
};

function positiveIntegerOrFallback(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : fallback;
}

export function normalizeSignerSettings(
  input?: Partial<SignerSettings> | null
): SignerSettings {
  return {
    sign_timeout_secs: positiveIntegerOrFallback(
      input?.sign_timeout_secs,
      DEFAULT_SIGNER_SETTINGS.sign_timeout_secs
    ),
    ping_timeout_secs: positiveIntegerOrFallback(
      input?.ping_timeout_secs,
      DEFAULT_SIGNER_SETTINGS.ping_timeout_secs
    ),
    request_ttl_secs: positiveIntegerOrFallback(
      input?.request_ttl_secs,
      DEFAULT_SIGNER_SETTINGS.request_ttl_secs
    ),
    state_save_interval_secs: positiveIntegerOrFallback(
      input?.state_save_interval_secs,
      DEFAULT_SIGNER_SETTINGS.state_save_interval_secs
    ),
    peer_selection_strategy:
      input?.peer_selection_strategy === 'random'
        ? 'random'
        : DEFAULT_SIGNER_SETTINGS.peer_selection_strategy
  };
}
