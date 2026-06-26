import {
  groupPackageFromWireJson,
  groupNameFromPackage,
  groupPackageToWireJson,
  groupPublicKeyFromPackage,
  totalCountFromGroupPackage,
  xOnlyFromCompressedPubkey,
  type BrowserGroupPackage,
  type BrowserProfilePackagePayload,
} from '../../profile-package';
import { publicKeyFromSecret } from './keys';
import type { BrowserProfilePreview, BrowserProfileSource } from './types';

export function groupJsonFromPayload(payload: BrowserProfilePackagePayload) {
  return groupPackageToWireJson(payload.groupPackage);
}

/**
 * Map a raw share secret to its `{ idx, seckey }` wire share within a known
 * group package, by matching the share's derived public key against the group
 * members. Unlike {@link shareJsonFromPayload} (which falls back to the first
 * member for an already-trusted local share), this THROWS when the secret is
 * not a member of the group — so a wrong-keyset paste during recovery/rotation
 * fails loudly instead of silently mis-indexing.
 */
export function shareWireFromSecret(groupPackage: BrowserGroupPackage, shareSecret: string) {
  const sharePublicKey = publicKeyFromSecret(shareSecret);
  const member = groupPackage.members.find(
    (candidate) => xOnlyFromCompressedPubkey(candidate.pubkey) === sharePublicKey,
  );
  if (!member) {
    throw new Error('This share does not belong to the selected keyset.');
  }
  return { idx: member.idx, seckey: shareSecret };
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

export type OnboardPreviewDisplayMeta = {
  keysetName: string;
  thresholdLabel: string;
  shareLabel: string;
};

/**
 * Derive human-facing onboarding metadata (keyset name, `threshold/count`
 * label, and `Share #idx`) from a profile preview. The share index is resolved
 * secret-free by matching the preview's share public key against the parsed
 * group members — the seckey-bearing `share_package_json` is never read.
 */
export function onboardPreviewDisplayMeta(
  preview: BrowserProfilePreview,
): OnboardPreviewDisplayMeta {
  const group = groupPackageFromWireJson(preview.group_package_json);
  const member = group.members.find(
    (candidate) => xOnlyFromCompressedPubkey(candidate.pubkey) === preview.share_public_key,
  );
  return {
    keysetName: groupNameFromPackage(group),
    thresholdLabel: `${group.threshold}/${totalCountFromGroupPackage(group)}`,
    shareLabel: member ? `Share #${member.idx}` : 'Share',
  };
}
