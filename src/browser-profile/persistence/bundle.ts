import { createBrowserStoredProfileProjection } from '../store/projection';
import {
  createProfilePackagePair,
  type BrowserProfilePackagePayload,
} from '../../profile-package';
import { DEFAULT_SIGNER_SETTINGS, type SignerSettings } from '../../signer-settings';
import type { BrowserProfileSource } from '../core';
import { assertBrowserProfileIdAvailable } from './duplicate';
import type { BrowserPersistedProfileBundle } from './types';

export async function createBrowserPersistedProfileBundle(args: {
  payload: BrowserProfilePackagePayload;
  password: string;
  source: BrowserProfileSource;
  profileString?: string;
  shareString?: string;
  signerSettings?: Partial<SignerSettings> | null;
  peerPubkey?: string | null;
  runtimeSnapshotJson?: string | null;
  artifactNamespace?: string;
  existingProfileIds?: string[] | null;
}): Promise<BrowserPersistedProfileBundle> {
  const projection = createBrowserStoredProfileProjection({
    payload: args.payload,
    source: args.source,
    signerSettings: args.signerSettings ?? DEFAULT_SIGNER_SETTINGS,
    peerPubkey: args.peerPubkey ?? null,
    runtimeSnapshotJson: args.runtimeSnapshotJson ?? null,
    artifactNamespace: args.artifactNamespace,
  });

  assertBrowserProfileIdAvailable({
    existingProfileIds: args.existingProfileIds,
    profileId: projection.summary.id,
    label: projection.preview.label,
  });

  const packagePair = await createProfilePackagePair(args.payload, args.password);

  return {
    projection,
    profileString: args.profileString ?? packagePair.profileString,
    shareString: args.shareString ?? packagePair.shareString,
  };
}
