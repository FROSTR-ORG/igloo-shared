import {
  createBrowserProfileArtifactRefs,
  createBrowserProfilePreview,
  type BrowserProfileSource,
} from '../core';
import { createBrowserStoredRuntimeProfile } from './summary';
import { normalizeBrowserStoredProfilePayload } from './normalize';
import type { BrowserStoredProfileProjection } from './types';

export function createBrowserStoredProfileProjection(args: {
  payload: Parameters<typeof normalizeBrowserStoredProfilePayload>[0]['profile'];
  source: BrowserProfileSource;
  labelOverride?: string;
  signerSettings?: Parameters<typeof normalizeBrowserStoredProfilePayload>[0]['signerSettings'];
  peerPubkey?: Parameters<typeof normalizeBrowserStoredProfilePayload>[0]['peerPubkey'];
  runtimeSnapshotJson?: Parameters<typeof normalizeBrowserStoredProfilePayload>[0]['runtimeSnapshotJson'];
  artifactNamespace?: string;
}): BrowserStoredProfileProjection {
  const storedPayload = normalizeBrowserStoredProfilePayload({
    version: args.payload.version,
    profile: args.payload,
    signerSettings: args.signerSettings,
    peerPubkey: args.peerPubkey,
    runtimeSnapshotJson: args.runtimeSnapshotJson,
  });
  return {
    preview: createBrowserProfilePreview(args.payload, args.source, args.labelOverride),
    summary: createBrowserStoredRuntimeProfile(storedPayload),
    artifactRefs: createBrowserProfileArtifactRefs(
      storedPayload.profile.profileId,
      args.artifactNamespace,
    ),
    storedPayload,
  };
}
