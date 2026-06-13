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

/**
 * Resolve the group + share package JSON for a clean profile bootstrap, from
 * either an explicit bootstrap profile or a package payload. Used both for the
 * `profile` bootstrap mode and to carry fallback packages alongside a persisted
 * snapshot so the runtime can re-bootstrap if the snapshot fails to restore.
 */
function resolveBootstrapPackages(
  profile: BrowserProfileRuntimeBootstrapInput,
  profilePayload?: BrowserRuntimeProfilePayload,
): { groupPackageJson: string; sharePackageJson: string } | null {
  if (profilePayload) {
    return {
      groupPackageJson: groupJsonFromPayload(profilePayload),
      sharePackageJson: shareJsonFromPayload(profilePayload),
    };
  }
  if ('groupPackageJson' in profile && 'sharePackageJson' in profile) {
    return {
      groupPackageJson: profile.groupPackageJson,
      sharePackageJson: profile.sharePackageJson,
    };
  }
  return null;
}

function bootstrapPeerPubkey32Hex(profile: BrowserProfileRuntimeBootstrapInput): string | undefined {
  return typeof profile.peerPubkey === 'string' && profile.peerPubkey.trim().length > 0
    ? profile.peerPubkey.trim().toLowerCase()
    : undefined;
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

  const packages = resolveBootstrapPackages(profile, profilePayload);

  if (snapshotJson) {
    return {
      config: {
        mode: 'persisted',
        relays: profile.relays,
        signerSettings: normalizeSignerSettings(profile.signerSettings),
        // Carry the profile packages (when known) so the runtime can fall back
        // to a clean bootstrap if the snapshot fails to restore — see the
        // resilient-restore path in the bridge.
        ...(packages
          ? {
              groupPackageJson: packages.groupPackageJson,
              sharePackageJson: packages.sharePackageJson,
              bootstrapPeerPubkey32Hex: bootstrapPeerPubkey32Hex(profile),
            }
          : {}),
      },
      restoreOptions: {
        runtimeSnapshotJson: snapshotJson,
      },
    };
  }

  if (!packages) {
    throw new Error('No runtime snapshot found. Unlock or import the profile again.');
  }

  return {
    config: {
      mode: 'profile',
      relays: profile.relays,
      signerSettings: normalizeSignerSettings(profile.signerSettings),
      bootstrapPeerPubkey32Hex: bootstrapPeerPubkey32Hex(profile),
      groupPackageJson: packages.groupPackageJson,
      sharePackageJson: packages.sharePackageJson,
    },
  };
}
