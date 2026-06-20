import type { BrowserProfilePreview } from '../browser-profile/core';
import {
  normalizeGroupMemberSharePublicKey,
  normalizeHex32,
  publicKeyFromSecret,
} from '../browser-profile/core';
import {
  decodeBfSharePackage,
  encodeBfOnboardPackage,
  groupPackageToWireJson,
  groupPublicKeyFromPackage,
  sharePackageToWireJson,
  type BrowserGroupPackage,
  type BrowserOnboardPackagePayload,
} from '../profile-package';
import { normalizeRelays } from '../relay-transport';
import { Secret } from '../secret';

export type BrowserOnboardSponsorshipReadiness =
  | {
      available: true;
      mode: 'package-producer' | 'source-share-package-producer';
      requiredSource: 'package-producer' | 'nsec-or-threshold-source-shares';
      safeActions: readonly ['configure-device'];
    }
  | {
      available: false;
      reason: 'saved-profile-local-share-only';
      missing: 'remote-share-package-producer';
      securityBoundary: 'saved-browser-profiles-retain-local-share-only';
      requiredSource: 'nsec-or-threshold-source-shares';
      safeActions: readonly [
        'export-local-share-as-source',
        'use-create-or-rotate-before-setup-finishes',
        'replace-share-from-prepared-package',
      ];
    };

export type BrowserOnboardSponsorshipInput = {
  /**
   * True only when the host has a real outside-runtime package-producer contract
   * that can mint a valid remote bfonboard package without cloning this device's
   * local share.
   */
  packageProducerAvailable?: boolean;
  /**
   * @deprecated Use packageProducerAvailable. Kept as a compatibility alias for
   * callers that adopted the first Settings sponsorship readiness draft.
   */
  runtimePackageProducerAvailable?: boolean;
  /**
   * True only when a caller has explicit source material for the remote member
   * being sponsored, such as an nsec-derived keyset plan or a threshold-source
   * share bundle. A saved browser profile alone must not set this.
   */
  sourceSharePackageProducerAvailable?: boolean;
};

export type BrowserOnboardSponsorshipPackageRequest = {
  label: string;
  groupPackage: BrowserGroupPackage;
  memberIdx: number;
  shareSecret: string;
  relays: string[];
  peerPubkey: string;
  password: string;
};

export type BrowserOnboardSponsorshipSourceShareRequest = {
  label: string;
  groupPackage: BrowserGroupPackage;
  sourcePackageText: string;
  sourcePackagePassword: string;
  relays: string[];
  peerPubkey: string;
  password: string;
};

export type BrowserOnboardSponsorshipPackageResult = {
  memberIdx: number;
  label: string;
  packageText: string;
  preview: BrowserProfilePreview;
};

export function getBrowserOnboardSponsorshipReadiness(
  input: BrowserOnboardSponsorshipInput = {},
): BrowserOnboardSponsorshipReadiness {
  if (input.packageProducerAvailable || input.runtimePackageProducerAvailable) {
    return {
      available: true,
      mode: 'package-producer',
      requiredSource: 'package-producer',
      safeActions: ['configure-device'],
    };
  }
  if (input.sourceSharePackageProducerAvailable) {
    return {
      available: true,
      mode: 'source-share-package-producer',
      requiredSource: 'nsec-or-threshold-source-shares',
      safeActions: ['configure-device'],
    };
  }

  return {
    available: false,
    reason: 'saved-profile-local-share-only',
    missing: 'remote-share-package-producer',
    securityBoundary: 'saved-browser-profiles-retain-local-share-only',
    requiredSource: 'nsec-or-threshold-source-shares',
    safeActions: [
      'export-local-share-as-source',
      'use-create-or-rotate-before-setup-finishes',
      'replace-share-from-prepared-package',
    ],
  };
}

export async function createBrowserOnboardSponsorshipPackage(
  input: BrowserOnboardSponsorshipPackageRequest,
): Promise<BrowserOnboardSponsorshipPackageResult> {
  if (!Number.isInteger(input.memberIdx) || input.memberIdx <= 0) {
    throw new Error('Invalid sponsorship member index.');
  }
  if (!input.password.trim()) {
    throw new Error('Sponsorship package password is required.');
  }

  const label = input.label.trim() || `Share #${input.memberIdx}`;
  const shareSecret = normalizeHex32(input.shareSecret, 'sponsorship share secret');
  const sharePublicKey = publicKeyFromSecret(shareSecret);
  const member = input.groupPackage.members.find((entry) => entry.idx === input.memberIdx);
  if (!member) {
    throw new Error(`Sponsorship member #${input.memberIdx} is not present in the group package.`);
  }
  if (normalizeGroupMemberSharePublicKey(member.pubkey) !== sharePublicKey) {
    throw new Error(`Sponsorship share does not match member #${input.memberIdx} in the group package.`);
  }

  const { relays } = normalizeRelays(input.relays);
  const peerPubkey = normalizeHex32(input.peerPubkey, 'sponsorship peer pubkey');
  const onboardPayload = {
    shareSecret,
    relays,
    peerPubkey,
  } satisfies BrowserOnboardPackagePayload;

  return {
    memberIdx: input.memberIdx,
    label,
    packageText: await encodeBfOnboardPackage(onboardPayload, Secret.of(input.password)),
    preview: {
      label,
      share_public_key: sharePublicKey,
      group_public_key: groupPublicKeyFromPackage(input.groupPackage),
      relays,
      group_package_json: groupPackageToWireJson(input.groupPackage),
      share_package_json: sharePackageToWireJson(input.memberIdx, shareSecret),
      source: 'bfonboard',
    },
  };
}

export async function createBrowserOnboardSponsorshipPackageFromBfshare(
  input: BrowserOnboardSponsorshipSourceShareRequest,
): Promise<BrowserOnboardSponsorshipPackageResult> {
  const sourcePackageText = input.sourcePackageText.trim();
  if (!sourcePackageText) {
    throw new Error('Source bfshare package is required.');
  }
  if (!input.sourcePackagePassword) {
    throw new Error('Source bfshare password is required.');
  }

  const source = await decodeBfSharePackage(sourcePackageText, Secret.of(input.sourcePackagePassword));
  const shareSecret = normalizeHex32(source.shareSecret, 'source bfshare secret');
  const sharePublicKey = publicKeyFromSecret(shareSecret);
  const member = input.groupPackage.members.find(
    (entry) => normalizeGroupMemberSharePublicKey(entry.pubkey) === sharePublicKey,
  );
  if (!member) {
    throw new Error('Source bfshare does not match any member in this keyset.');
  }

  return createBrowserOnboardSponsorshipPackage({
    label: input.label,
    groupPackage: input.groupPackage,
    memberIdx: member.idx,
    shareSecret,
    relays: input.relays,
    peerPubkey: input.peerPubkey,
    password: input.password,
  });
}
