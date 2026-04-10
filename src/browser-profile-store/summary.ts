import { createBrowserRuntimeProfileSummary } from '../browser-profile';
import { normalizeBrowserStoredProfilePayload } from './normalize';
import type { BrowserStoredProfilePayloadInput, BrowserStoredRuntimeProfile } from './types';

export function createBrowserStoredRuntimeProfile(
  input: BrowserStoredProfilePayloadInput,
): BrowserStoredRuntimeProfile {
  const normalized = normalizeBrowserStoredProfilePayload(input);
  return {
    ...createBrowserRuntimeProfileSummary({
      payload: normalized.profile,
      peerPubkey: normalized.peerPubkey,
      runtimeSnapshotJson: normalized.runtimeSnapshotJson,
      signerSettings: normalized.signerSettings,
    }),
    signerSettings: normalized.signerSettings,
  };
}
