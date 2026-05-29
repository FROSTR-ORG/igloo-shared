import { DEFAULT_RELAYS, normalizeRelays } from '../relay-transport';
import {
  deriveProfileIdFromShareSecret,
  type BrowserManualPeerPolicyOverride,
  type BrowserProfilePackagePayload,
} from '../profile-package';
import { normalizeSignerSettings, type SignerSettings } from '../signer-settings';
import { normalizeGroupMemberSharePublicKey, normalizeHex32, publicKeyFromSecret } from './keys';
import type { BrowserRuntimeProfileSummary } from './types';

export function createDefaultManualPeerPolicy(): BrowserManualPeerPolicyOverride['policy'] {
  return {
    request: { echo: 'unset', ping: 'unset', onboard: 'unset', sign: 'unset', ecdh: 'unset' },
    respond: { echo: 'unset', ping: 'unset', onboard: 'unset', sign: 'unset', ecdh: 'unset' },
  };
}

export function createBrowserRuntimeProfileSummary(args: {
  payload: BrowserProfilePackagePayload;
  peerPubkey?: string | null;
  runtimeSnapshotJson?: string | null;
  signerSettings?: Partial<SignerSettings> | null;
}) {
  const relays = normalizeRelays(args.payload.device.relays?.length ? args.payload.device.relays : DEFAULT_RELAYS).relays;
  const label = args.payload.device.name.trim();
  const groupName = args.payload.groupPackage.groupName?.trim() || undefined;
  const groupPublicKey = args.payload.groupPackage.groupPk.trim().toLowerCase();
  const sharePublicKey = publicKeyFromSecret(args.payload.device.shareSecret);
  const peerPubkey = args.peerPubkey?.trim().toLowerCase() || undefined;
  const runtimeSnapshotJson =
    typeof args.runtimeSnapshotJson === 'string' && args.runtimeSnapshotJson.trim().length > 0
      ? args.runtimeSnapshotJson
      : undefined;

  return {
    id: args.payload.profileId,
    label,
    groupName,
    relays,
    groupPublicKey,
    sharePublicKey,
    publicKey: groupPublicKey,
    peerPubkey,
    signerSettings: args.signerSettings ? normalizeSignerSettings(args.signerSettings) : undefined,
    runtimeSnapshotJson,
  } satisfies BrowserRuntimeProfileSummary;
}

export async function profilePayloadFromRuntimeSnapshot(args: {
  label: string;
  relays: string[];
  runtimeSnapshotJson: string;
}): Promise<BrowserProfilePackagePayload> {
  const snapshot = JSON.parse(args.runtimeSnapshotJson) as {
    bootstrap?: {
      group?: {
        group_pk?: string;
        threshold?: number;
        members?: Array<{ idx?: number; pubkey?: string }>;
      };
      share?: {
        seckey?: string;
      };
    };
  };
  const group = snapshot.bootstrap?.group;
  const share = snapshot.bootstrap?.share;
  const members =
    group?.members?.map((member) => ({
      idx: Math.trunc(member.idx ?? 0),
      pubkey: (() => {
        const normalized = (member.pubkey ?? '').trim().toLowerCase();
        if (/^(02|03)[0-9a-f]{64}$/.test(normalized)) {
          return normalized;
        }
        return `02${normalizeGroupMemberSharePublicKey(member.pubkey ?? '')}`;
      })(),
    })) ?? [];
  const shareSecret = normalizeHex32(share?.seckey ?? '', 'share secret');
  const sharePublicKey = publicKeyFromSecret(shareSecret);
  const label = args.label.trim() || 'Onboarded device';

  return {
    profileId: await deriveProfileIdFromShareSecret(shareSecret),
    version: 1,
    device: {
      name: label,
      shareSecret,
      manualPeerPolicyOverrides: members
        .filter((member) => member.pubkey.slice(2).toLowerCase() !== sharePublicKey)
        .map((member) => ({
          pubkey: member.pubkey.slice(2).toLowerCase(),
          policy: createDefaultManualPeerPolicy(),
        })),
      relays: args.relays,
    },
    groupPackage: {
      groupName: label,
      groupPk: normalizeHex32(group?.group_pk ?? '', 'group public key'),
      threshold: Math.trunc(group?.threshold ?? 0),
      members,
    },
  };
}
