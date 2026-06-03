import {
  createFinalizedBrowserStoredProfile,
  reconstructBrowserProfilePackagePayload,
} from '../browser-profile/store';
import { groupPublicKeyFromPackage, type BrowserProfilePackagePayload } from '../profile-package';
import { createConnectedBrowserProfilePayload } from './connect';
import type { BrowserRotationProfileFinalizeArgs } from './types';

export function prepareBrowserRotationProfilePayload(args: {
  targetProfilePayload: BrowserProfilePackagePayload;
  connectedProfilePayload: BrowserProfilePackagePayload;
  targetLabel: string;
}): BrowserProfilePackagePayload {
  const nextPayload = createConnectedBrowserProfilePayload({
    profilePayload: args.connectedProfilePayload,
    label: args.targetLabel,
  });

  if (
    groupPublicKeyFromPackage(nextPayload.groupPackage) !==
    groupPublicKeyFromPackage(args.targetProfilePayload.groupPackage)
  ) {
    throw new Error('Rotation package does not match the selected profile group public key.');
  }
  if (nextPayload.profileId === args.targetProfilePayload.profileId) {
    throw new Error('Rotation package did not produce a new device profile id.');
  }

  return nextPayload;
}

export async function finalizeRotatedBrowserProfile(
  args: BrowserRotationProfileFinalizeArgs,
) {
  const targetProfilePayload = reconstructBrowserProfilePackagePayload(args.targetProfile);
  const nextPayload = prepareBrowserRotationProfilePayload({
    connectedProfilePayload: args.connection.profilePayload,
    targetProfilePayload,
    targetLabel: args.targetProfile.label,
  });

  return await createFinalizedBrowserStoredProfile({
    payload: nextPayload,
    password: args.targetProfile.storedPassword,
    source: 'bfonboard',
    existingProfileIds: (args.existingProfileIds ?? []).filter(
      (profileId) => profileId !== args.targetProfile.id,
    ),
    onboardingPackage: args.connection.packageText,
    runtimeSnapshotJson:
      args.connection.runtimeSnapshotJson ?? args.targetProfile.runtimeSnapshotJson ?? null,
    peerPubkey: args.connection.peerPubkey ?? args.targetProfile.peerPubkey ?? null,
  });
}
