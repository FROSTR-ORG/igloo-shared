import { groupJsonFromPayload, shareJsonFromPayload } from '../core';
import { normalizeSignerSettings } from '../../signer-settings';
import type {
  BrowserProfileRuntimeBootstrapInput,
  BrowserRuntimeNodeInit,
  BrowserRuntimeProfilePayload,
} from './types';

export function createBrowserRuntimeNodeInit(
  profile: BrowserProfileRuntimeBootstrapInput,
  profilePayload?: BrowserRuntimeProfilePayload,
): BrowserRuntimeNodeInit {
  const snapshotJson =
    typeof profile.runtimeSnapshotJson === 'string' && profile.runtimeSnapshotJson.trim().length > 0
      ? profile.runtimeSnapshotJson
      : null;

  if (snapshotJson) {
    return {
      config: {
        mode: 'persisted',
        relays: profile.relays,
        signerSettings: normalizeSignerSettings(profile.signerSettings),
      },
      restoreOptions: {
        runtimeSnapshotJson: snapshotJson,
      },
    };
  }

  if (!profilePayload) {
    if ('groupPackageJson' in profile && 'sharePackageJson' in profile) {
      return {
        config: {
          mode: 'profile',
          relays: profile.relays,
          signerSettings: normalizeSignerSettings(profile.signerSettings),
          bootstrapPeerPubkey32Hex:
            typeof profile.peerPubkey === 'string' && profile.peerPubkey.trim().length > 0
              ? profile.peerPubkey.trim().toLowerCase()
              : undefined,
          groupPackageJson: profile.groupPackageJson,
          sharePackageJson: profile.sharePackageJson,
        },
      };
    }
    throw new Error('No runtime snapshot found. Unlock or import the profile again.');
  }

  return {
    config: {
      mode: 'profile',
      relays: profile.relays,
      signerSettings: normalizeSignerSettings(profile.signerSettings),
      bootstrapPeerPubkey32Hex:
        typeof profile.peerPubkey === 'string' && profile.peerPubkey.trim().length > 0
          ? profile.peerPubkey.trim().toLowerCase()
          : undefined,
      groupPackageJson: groupJsonFromPayload(profilePayload),
      sharePackageJson: shareJsonFromPayload(profilePayload),
    },
  };
}
