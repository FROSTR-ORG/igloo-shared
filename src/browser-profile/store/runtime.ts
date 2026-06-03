import type { RuntimePeerPermissionState } from '../../wire';
import { createDefaultManualPeerPolicy } from '../core';
import type { BrowserManualPeerPolicyOverride } from '../../profile-package';
import type { SignerSettings } from '../../signer-settings';
import { reconstructBrowserProfilePackagePayload, type BrowserStoredProfilePayloadSource } from './reconstruct';
import { createBrowserStoredRuntimeProfile } from './summary';
import type { BrowserStoredRuntimeProfile } from './types';

export type BrowserRuntimeProfileProjection = {
  summary: BrowserStoredRuntimeProfile;
  manualPeerPolicyOverrides: BrowserManualPeerPolicyOverride[];
};

export function createBrowserRuntimeProfileProjection(args: {
  profile: BrowserStoredProfilePayloadSource & {
    peerPubkey?: string | null;
    runtimeSnapshotJson?: string | null;
  };
  signerSettings?: Partial<SignerSettings> | null;
  runtimeSnapshotJson?: string | null;
  peerPermissionStates: RuntimePeerPermissionState[];
}): BrowserRuntimeProfileProjection {
  const payload = reconstructBrowserProfilePackagePayload(args.profile);
  const summary = createBrowserStoredRuntimeProfile({
    version: payload.version,
    profile: payload,
    signerSettings: args.signerSettings ?? undefined,
    peerPubkey: args.profile.peerPubkey ?? undefined,
    runtimeSnapshotJson: args.runtimeSnapshotJson ?? args.profile.runtimeSnapshotJson ?? undefined,
  });

  return {
    summary,
    manualPeerPolicyOverrides: args.peerPermissionStates.map((policy) => ({
      pubkey: policy.pubkey,
      policy: {
        request: {
          ...createDefaultManualPeerPolicy().request,
          ...policy.manual_override.request,
        },
        respond: {
          ...createDefaultManualPeerPolicy().respond,
          ...policy.manual_override.respond,
        },
      },
    })),
  };
}
