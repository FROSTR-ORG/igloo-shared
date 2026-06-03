import {
  groupPackageToWireJson,
  groupPublicKeyFromPackage,
  xOnlyFromCompressedPubkey,
  type BrowserProfilePackagePayload,
} from '../../profile-package';
import { publicKeyFromSecret } from './keys';
import type { BrowserProfilePreview, BrowserProfileSource } from './types';

export function groupJsonFromPayload(payload: BrowserProfilePackagePayload) {
  return groupPackageToWireJson(payload.groupPackage);
}

export function shareJsonFromPayload(payload: BrowserProfilePackagePayload) {
  const sharePublicKey = publicKeyFromSecret(payload.device.shareSecret);
  const member =
    payload.groupPackage.members.find((candidate) => xOnlyFromCompressedPubkey(candidate.pubkey) === sharePublicKey) ??
    payload.groupPackage.members[0];
  return JSON.stringify(
    {
      idx: member?.idx ?? 1,
      seckey: payload.device.shareSecret,
    },
    null,
    2,
  );
}

export function createBrowserProfilePreview(
  payload: BrowserProfilePackagePayload,
  source: BrowserProfileSource,
  labelOverride?: string,
): BrowserProfilePreview {
  return {
    label: labelOverride?.trim() || payload.device.name,
    share_public_key: publicKeyFromSecret(payload.device.shareSecret),
    group_public_key: groupPublicKeyFromPackage(payload.groupPackage),
    relays: payload.device.relays,
    group_package_json: groupJsonFromPayload(payload),
    share_package_json: shareJsonFromPayload(payload),
    source,
  };
}
