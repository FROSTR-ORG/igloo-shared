import type {
  BrowserProfileArtifactRefs,
  BrowserProfilePreview,
  BrowserProfileSource,
} from '../core';
import { createBrowserPersistedProfileBundle } from '../persistence';
import type {
  BrowserManualPeerPolicyOverride,
  BrowserProfilePackagePayload,
} from '../../profile-package';
import type { SignerSettings } from '../../signer-settings';
import type {
  BrowserStoredRuntimeProfile,
  NormalizedBrowserStoredProfilePayload,
} from './types';

export type BrowserFinalizedStoredProfile = {
  source: BrowserProfileSource;
  preview: BrowserProfilePreview;
  summary: BrowserStoredRuntimeProfile;
  artifactRefs: BrowserProfileArtifactRefs;
  storedPayload: NormalizedBrowserStoredProfilePayload;
  storedPassword: string;
  profileString: string;
  shareString: string;
  onboardingPackage: string | null;
  manualPeerPolicyOverrides: BrowserManualPeerPolicyOverride[];
  peerPubkey: string | null;
  runtimeSnapshotJson: string | null;
};

export async function createFinalizedBrowserStoredProfile(args: {
  payload: BrowserProfilePackagePayload;
  password: string;
  source: BrowserProfileSource;
  existingProfileIds?: string[] | null;
  profileString?: string;
  shareString?: string;
  onboardingPackage?: string | null;
  runtimeSnapshotJson?: string | null;
  peerPubkey?: string | null;
  signerSettings?: Partial<SignerSettings> | null;
  artifactNamespace?: string;
  publishBackup?: boolean;
}): Promise<BrowserFinalizedStoredProfile> {
  const bundle = await createBrowserPersistedProfileBundle({
    payload: args.payload,
    password: args.password,
    source: args.source,
    profileString: args.profileString,
    shareString: args.shareString,
    signerSettings: args.signerSettings,
    peerPubkey: args.peerPubkey,
    runtimeSnapshotJson: args.runtimeSnapshotJson,
    artifactNamespace: args.artifactNamespace,
    publishBackup: args.publishBackup,
    existingProfileIds: args.existingProfileIds,
  });
  const { preview, summary, artifactRefs, storedPayload } = bundle.projection;

  return {
    source: args.source,
    preview,
    summary,
    artifactRefs,
    storedPayload,
    storedPassword: args.password,
    profileString: bundle.profileString,
    shareString: bundle.shareString,
    onboardingPackage: args.onboardingPackage ?? null,
    manualPeerPolicyOverrides: args.payload.device.manualPeerPolicyOverrides,
    peerPubkey: summary.peerPubkey ?? null,
    runtimeSnapshotJson: summary.runtimeSnapshotJson ?? null,
  };
}
