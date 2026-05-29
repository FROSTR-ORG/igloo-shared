import { DEFAULT_RELAYS, normalizeRelays } from '../../relay-transport';
import { normalizeSignerSettings } from '../../signer-settings';
import type {
  BrowserStoredProfilePayloadInput,
  NormalizedBrowserStoredProfilePayload,
} from './types';

export function normalizeBrowserStoredProfilePayload(
  input: BrowserStoredProfilePayloadInput,
): NormalizedBrowserStoredProfilePayload {
  const { relays } = normalizeRelays(
    input.profile.device.relays?.length ? input.profile.device.relays : DEFAULT_RELAYS,
  );
  return {
    version: 1,
    profile: {
      ...input.profile,
      device: {
        ...input.profile.device,
        name: input.profile.device.name.trim(),
        relays,
      },
    },
    signerSettings: normalizeSignerSettings(input.signerSettings),
    peerPubkey: input.peerPubkey?.trim().toLowerCase() || undefined,
    runtimeSnapshotJson:
      typeof input.runtimeSnapshotJson === 'string' && input.runtimeSnapshotJson.trim().length > 0
        ? input.runtimeSnapshotJson
        : undefined,
  };
}
