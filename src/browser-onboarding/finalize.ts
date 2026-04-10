import { createFinalizedBrowserStoredProfile } from '../browser-profile-store';
import { createConnectedBrowserProfilePayload } from './connect';
import type { BrowserConnectedProfileFinalizeArgs } from './types';

export async function finalizeConnectedBrowserProfile(
  args: BrowserConnectedProfileFinalizeArgs,
) {
  const payload = createConnectedBrowserProfilePayload({
    profilePayload: args.connection.profilePayload,
    label: args.label,
  });

  return await createFinalizedBrowserStoredProfile({
    payload,
    password: args.password,
    source: 'bfonboard',
    existingProfileIds: args.existingProfileIds,
    onboardingPackage: args.connection.packageText,
    runtimeSnapshotJson: args.connection.runtimeSnapshotJson ?? null,
    peerPubkey: args.connection.peerPubkey ?? null,
  });
}
