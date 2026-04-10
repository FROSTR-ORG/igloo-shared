import type { BrowserProfileArtifactRefs, BrowserProfilePreview, BrowserRuntimeProfileSummary } from '../browser-profile';
import type { BrowserProfilePackagePayload } from '../profile-package';
import type { SignerSettings } from '../signer-settings';

export type BrowserStoredProfilePayloadInput = {
  version: number;
  profile: BrowserProfilePackagePayload;
  signerSettings?: Partial<SignerSettings> | null;
  peerPubkey?: string | null;
  runtimeSnapshotJson?: string | null;
};

export type NormalizedBrowserStoredProfilePayload = {
  version: 1;
  profile: BrowserProfilePackagePayload;
  signerSettings: SignerSettings;
  peerPubkey?: string;
  runtimeSnapshotJson?: string;
};

export type BrowserStoredRuntimeProfile = BrowserRuntimeProfileSummary & {
  signerSettings: SignerSettings;
};

export type BrowserStoredProfileProjection = {
  preview: BrowserProfilePreview;
  summary: BrowserStoredRuntimeProfile;
  artifactRefs: BrowserProfileArtifactRefs;
  storedPayload: NormalizedBrowserStoredProfilePayload;
};
