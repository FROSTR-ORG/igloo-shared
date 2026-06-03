import {
  importBrowserProfilePackage,
  type BrowserImportedProfilePackage,
} from '../recovery';
import { createFinalizedBrowserStoredProfile } from '../store';
import type { SignerSettings } from '../../signer-settings';
import { logSharedSaveFailure, saveFinalizedBrowserProfileAndMaybeActivate } from './common';
import type { BrowserSaveActivateOptions } from './types';

export async function saveImportedBrowserProfileAndMaybeActivate<TProfile, TRuntime>(args: {
  packageText: string;
  password: string;
  existingProfileIds?: string[] | null;
  signerSettings?: Partial<SignerSettings> | null;
  peerPubkey?: string | null;
  runtimeSnapshotJson?: string | null;
  artifactNamespace?: string;
  publishBackup?: boolean;
  persistProfile: (input: {
    imported: BrowserImportedProfilePackage;
    finalized: Awaited<ReturnType<typeof createFinalizedBrowserStoredProfile>>;
    password: string;
  }) => Promise<TProfile>;
} & BrowserSaveActivateOptions<TRuntime>) {
  let imported: BrowserImportedProfilePackage;
  try {
    imported = await importBrowserProfilePackage(args.packageText, args.password);
  } catch (error) {
    logSharedSaveFailure({ flowKind: 'bfprofile', stage: 'decode', error });
    throw error;
  }

  let finalized: Awaited<ReturnType<typeof createFinalizedBrowserStoredProfile>>;
  try {
    finalized = await createFinalizedBrowserStoredProfile({
      payload: imported.payload,
      password: args.password,
      source: imported.source,
      existingProfileIds: args.existingProfileIds,
      profileString: imported.profileString,
      shareString: imported.shareString,
      signerSettings: args.signerSettings ?? null,
      peerPubkey: args.peerPubkey ?? null,
      runtimeSnapshotJson: args.runtimeSnapshotJson ?? null,
      artifactNamespace: args.artifactNamespace,
      publishBackup: args.publishBackup ?? false,
    });
  } catch (error) {
    logSharedSaveFailure({
      flowKind: imported.source,
      stage: 'finalize',
      profileId: imported.payload.profileId,
      error,
    });
    throw error;
  }

  return await saveFinalizedBrowserProfileAndMaybeActivate({
    finalized,
    persistProfile: async ({ finalized, password }) =>
      await args.persistProfile({
        imported,
        finalized,
        password,
      }),
    autoStart: args.autoStart,
    activate: args.activate,
    runtimeUnavailableMessage: args.runtimeUnavailableMessage,
    onRuntimeUnavailable: args.onRuntimeUnavailable,
  });
}
