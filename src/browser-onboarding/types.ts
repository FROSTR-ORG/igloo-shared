import type { BrowserProfilePreview } from '../browser-profile/core';
import type { BrowserFinalizedStoredProfile } from '../browser-profile/store';
import type {
  BrowserManualPeerPolicyOverride,
  BrowserProfilePackagePayload,
} from '../profile-package';

export type BrowserConnectedProfileInput = {
  profilePayload: BrowserProfilePackagePayload;
  label: string;
};

export type BrowserOnboardingConnection = {
  preview: BrowserProfilePreview;
  storedPassword: string;
  packageText: string;
  profileString: string;
  shareString: string;
  profilePayload: BrowserProfilePackagePayload;
  manualPeerPolicyOverrides: BrowserManualPeerPolicyOverride[];
  peerPubkey?: string | null;
  runtimeSnapshotJson?: string | null;
};

export type BrowserConnectedProfileFinalizeArgs = {
  connection: BrowserOnboardingConnection;
  label: string;
  password: string;
  existingProfileIds?: string[] | null;
};

export type BrowserRotationProfileTarget = {
  id: string;
  label: string;
  relays: string[];
  groupPackageJson: string;
  sharePackageJson: string;
  manualPeerPolicyOverrides: BrowserManualPeerPolicyOverride[];
  storedPassword: string;
  runtimeSnapshotJson?: string | null;
  peerPubkey?: string | null;
};

export type BrowserRotationProfileFinalizeArgs = {
  targetProfile: BrowserRotationProfileTarget;
  connection: BrowserOnboardingConnection;
  existingProfileIds?: string[] | null;
};

export type BrowserConnectedProfileFinalizeResult = Promise<BrowserFinalizedStoredProfile>;
