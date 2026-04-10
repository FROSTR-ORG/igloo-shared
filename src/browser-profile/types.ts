import type { SignerSettings } from '../signer-settings';

export type BrowserProfileSource = 'generated' | 'bfprofile' | 'bfshare' | 'bfonboard';

export type BrowserProfilePreview = {
  label: string;
  share_public_key: string;
  group_public_key: string;
  relays: string[];
  group_package_json: string;
  share_package_json: string;
  source: BrowserProfileSource;
};

export type BrowserRuntimeProfileSummary = {
  id: string;
  label: string;
  groupName?: string;
  relays: string[];
  groupPublicKey: string;
  sharePublicKey: string;
  publicKey: string;
  peerPubkey?: string;
  signerSettings?: SignerSettings;
  runtimeSnapshotJson?: string;
};

export type BrowserProfileArtifactRefs = {
  groupRef: string;
  encryptedProfileRef: string;
  statePath: string;
};
