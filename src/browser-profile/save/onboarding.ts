import {
  createConnectedBrowserProfilePayload,
  prepareBrowserRotationProfilePayload,
  type BrowserRotationProfileTarget,
} from '../../browser-onboarding';
import {
  createFinalizedBrowserStoredProfile,
  reconstructBrowserProfilePackagePayload,
} from '../store';
import type { BrowserProfilePackagePayload } from '../../profile-package';
import type { SignerSettings } from '../../signer-settings';
import { logSharedSaveFailure, saveFinalizedBrowserProfileAndMaybeActivate } from './common';
import type { BrowserPersistFinalizedProfile, BrowserSaveActivateOptions } from './types';

export async function saveConnectedBrowserProfileAndMaybeActivate<TProfile, TRuntime>(args: {
  profilePayload: BrowserProfilePackagePayload;
  label: string;
  password: string;
  existingProfileIds?: string[] | null;
  signerSettings?: Partial<SignerSettings> | null;
  peerPubkey?: string | null;
  runtimeSnapshotJson?: string | null;
  onboardingPackage?: string | null;
  artifactNamespace?: string;
  publishBackup?: boolean;
  persistProfile: BrowserPersistFinalizedProfile<TProfile>;
} & BrowserSaveActivateOptions<TRuntime>) {
  const payload = createConnectedBrowserProfilePayload({
    profilePayload: args.profilePayload,
    label: args.label,
  });

  let finalized: Awaited<ReturnType<typeof createFinalizedBrowserStoredProfile>>;
  try {
    finalized = await createFinalizedBrowserStoredProfile({
      payload,
      password: args.password,
      source: 'bfonboard',
      existingProfileIds: args.existingProfileIds,
      signerSettings: args.signerSettings ?? null,
      peerPubkey: args.peerPubkey ?? null,
      runtimeSnapshotJson: args.runtimeSnapshotJson ?? null,
      onboardingPackage: args.onboardingPackage ?? null,
      artifactNamespace: args.artifactNamespace,
      publishBackup: args.publishBackup ?? false,
    });
  } catch (error) {
    logSharedSaveFailure({
      flowKind: 'bfonboard',
      stage: 'finalize',
      profileId: payload.profileId,
      error,
    });
    throw error;
  }

  return await saveFinalizedBrowserProfileAndMaybeActivate({
    finalized,
    persistProfile: args.persistProfile,
    autoStart: args.autoStart,
    activate: args.activate,
    runtimeUnavailableMessage: args.runtimeUnavailableMessage,
    onRuntimeUnavailable: args.onRuntimeUnavailable,
  });
}

export async function saveRotatedBrowserProfileAndMaybeActivate<TProfile, TRuntime>(args: {
  targetProfile: BrowserRotationProfileTarget;
  connectedProfilePayload: BrowserProfilePackagePayload;
  password?: string;
  existingProfileIds?: string[] | null;
  signerSettings?: Partial<SignerSettings> | null;
  peerPubkey?: string | null;
  runtimeSnapshotJson?: string | null;
  onboardingPackage?: string | null;
  artifactNamespace?: string;
  publishBackup?: boolean;
  persistProfile: BrowserPersistFinalizedProfile<TProfile>;
} & BrowserSaveActivateOptions<TRuntime>) {
  let targetPayload: BrowserProfilePackagePayload;
  try {
    targetPayload = reconstructBrowserProfilePackagePayload(args.targetProfile);
  } catch (error) {
    logSharedSaveFailure({
      flowKind: 'rotation',
      stage: 'reconstruct',
      profileId: args.targetProfile.id,
      error,
    });
    throw error;
  }

  const payload = prepareBrowserRotationProfilePayload({
    targetProfilePayload: targetPayload,
    connectedProfilePayload: args.connectedProfilePayload,
    targetLabel: args.targetProfile.label,
  });

  let finalized: Awaited<ReturnType<typeof createFinalizedBrowserStoredProfile>>;
  try {
    finalized = await createFinalizedBrowserStoredProfile({
      payload,
      password: args.password ?? args.targetProfile.storedPassword,
      source: 'bfonboard',
      existingProfileIds: (args.existingProfileIds ?? []).filter(
        (profileId) => profileId !== args.targetProfile.id,
      ),
      signerSettings: args.signerSettings ?? null,
      peerPubkey: args.peerPubkey ?? args.targetProfile.peerPubkey ?? null,
      runtimeSnapshotJson:
        args.runtimeSnapshotJson ?? args.targetProfile.runtimeSnapshotJson ?? null,
      onboardingPackage: args.onboardingPackage ?? null,
      artifactNamespace: args.artifactNamespace,
      publishBackup: args.publishBackup ?? false,
    });
  } catch (error) {
    logSharedSaveFailure({
      flowKind: 'rotation',
      stage: 'finalize',
      profileId: payload.profileId,
      error,
    });
    throw error;
  }

  return await saveFinalizedBrowserProfileAndMaybeActivate({
    finalized,
    persistProfile: args.persistProfile,
    autoStart: args.autoStart,
    activate: args.activate,
    runtimeUnavailableMessage: args.runtimeUnavailableMessage,
    onRuntimeUnavailable: args.onRuntimeUnavailable,
  });
}
