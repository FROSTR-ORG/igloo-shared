import { createBrowserProfilePreview } from '../browser-profile';
import { runtimePayloadFromSnapshot } from '../browser-runtime-session';
import { createProfilePackagePair, type BrowserProfilePackagePayload } from '../profile-package';
import type {
  BrowserConnectedProfileInput,
  BrowserOnboardingConnection,
} from './types';

export function createConnectedBrowserProfilePayload(
  input: BrowserConnectedProfileInput,
): BrowserProfilePackagePayload {
  return {
    ...input.profilePayload,
    device: {
      ...input.profilePayload.device,
      name: input.label.trim(),
    },
  };
}

export async function createBrowserOnboardingConnection(args: {
  packageText: string;
  password: string;
  label: string;
  relays: string[];
  runtimeSnapshotJson: string;
  peerPubkey?: string | null;
}): Promise<BrowserOnboardingConnection> {
  const profilePayload = await runtimePayloadFromSnapshot({
    label: args.label,
    relays: args.relays,
    runtimeSnapshotJson: args.runtimeSnapshotJson,
  });
  const packagePair = await createProfilePackagePair(profilePayload, args.password);

  return {
    preview: createBrowserProfilePreview(profilePayload, 'bfonboard'),
    storedPassword: args.password,
    packageText: args.packageText.trim(),
    profileString: packagePair.profileString,
    shareString: packagePair.shareString,
    profilePayload,
    manualPeerPolicyOverrides: profilePayload.device.manualPeerPolicyOverrides,
    peerPubkey: args.peerPubkey ?? null,
    runtimeSnapshotJson: args.runtimeSnapshotJson,
  };
}
