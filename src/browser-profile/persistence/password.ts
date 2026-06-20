import {
  createProfilePackagePair,
  decodeBfProfilePackage,
  type BrowserManualPeerPolicyOverride,
  type BrowserProfilePackagePayload,
} from '../../profile-package';

export type BrowserProfilePasswordChangeResult = {
  payload: BrowserProfilePackagePayload;
  profileString: string;
  shareString: string;
};

export async function changeBrowserProfilePackagePassword(args: {
  profileString: string;
  currentPassword: string;
  nextPassword: string;
  label?: string | null;
  relays?: string[] | null;
  manualPeerPolicyOverrides?: BrowserManualPeerPolicyOverride[] | null;
}): Promise<BrowserProfilePasswordChangeResult> {
  if (!args.profileString.trim()) {
    throw new Error('No profile package is available for this profile.');
  }

  const payload = await decodeBfProfilePackage(args.profileString, args.currentPassword);
  const nextPayload: BrowserProfilePackagePayload = {
    ...payload,
    device: {
      ...payload.device,
      name: args.label?.trim() || payload.device.name,
      relays: args.relays ?? payload.device.relays,
      manualPeerPolicyOverrides:
        args.manualPeerPolicyOverrides ?? payload.device.manualPeerPolicyOverrides,
    },
  };
  const pair = await createProfilePackagePair(nextPayload, args.nextPassword);

  return {
    payload: nextPayload,
    profileString: pair.profileString,
    shareString: pair.shareString,
  };
}
