import { createSignerNode } from '../browser-runtime-core';
import type { BrowserProfilePackagePayload } from '../profile-package';
import type { SignerSettings } from '../signer-settings';

export type BrowserRuntimeStoredProfile = {
  relays: string[];
  signerSettings?: Partial<SignerSettings>;
  peerPubkey?: string;
  runtimeSnapshotJson?: string | null;
};

export type BrowserRuntimeBootstrapProfile = BrowserRuntimeStoredProfile & {
  groupPackageJson: string;
  sharePackageJson: string;
};

export type BrowserRuntimeNodeInit = {
  config: Parameters<typeof createSignerNode>[0];
  restoreOptions?: Parameters<typeof createSignerNode>[1];
};

export type BrowserRuntimeWarning = {
  code: 'runtime_unavailable';
  message: string;
  detail?: string;
};

export type BrowserProfileSaveResult<TProfile, TRuntime = unknown> = {
  profile: TProfile;
  runtime: TRuntime | null;
  runtimeWarning: BrowserRuntimeWarning | null;
};

export type BrowserProfileRuntimeBootstrapInput =
  | BrowserRuntimeStoredProfile
  | BrowserRuntimeBootstrapProfile;

export type BrowserRuntimeProfilePayload = BrowserProfilePackagePayload;
