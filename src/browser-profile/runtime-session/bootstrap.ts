import { groupJsonFromPayload, shareJsonFromPayload } from '../core';
import { normalizeSignerSettings } from '../../signer-settings';
import type {
  BrowserProfileRuntimeBootstrapInput,
  BrowserRuntimeNodeInit,
  BrowserRuntimeProfilePayload,
} from './types';

/**
 * A persisted runtime snapshot is only usable if it is at least structurally
 * intact JSON. A corrupt/truncated snapshot (e.g. an interrupted write, or a
 * stale blob carried forward across profile saves) must not be fed to the WASM
 * restore path, where it would throw and fail session start on a fresh browser
 * session. Discarding it here falls the bootstrap through to a clean profile
 * restore (or a clear "unlock/import again" error) instead of crashing.
 *
 * Note: this only catches structural corruption. A snapshot that parses but is
 * semantically incompatible with the current runtime is a deeper concern
 * (versioned snapshots + a restore-failure fallback) tracked in dev/BACKLOG.md.
 */
function isStructurallyRestorableSnapshot(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    return parsed != null && typeof parsed === 'object';
  } catch {
    return false;
  }
}

export function createBrowserRuntimeNodeInit(
  profile: BrowserProfileRuntimeBootstrapInput,
  profilePayload?: BrowserRuntimeProfilePayload,
): BrowserRuntimeNodeInit {
  const snapshotJson =
    typeof profile.runtimeSnapshotJson === 'string' &&
    profile.runtimeSnapshotJson.trim().length > 0 &&
    isStructurallyRestorableSnapshot(profile.runtimeSnapshotJson)
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
