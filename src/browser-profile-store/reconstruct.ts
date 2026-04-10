import {
  groupJsonFromPayload,
  normalizeGroupMemberSharePublicKey,
  normalizeHex32,
  shareJsonFromPayload,
} from '../browser-profile';
import { createLogger } from '../observability';
import type {
  BrowserManualPeerPolicyOverride,
  BrowserProfilePackagePayload,
} from '../profile-package';

const logger = createLogger('browser.profile-store');

export type BrowserStoredProfilePayloadSource = {
  id: string;
  label: string;
  relays: string[];
  groupPackageJson: string;
  sharePackageJson: string;
  manualPeerPolicyOverrides?: BrowserManualPeerPolicyOverride[] | null;
};

export function createBrowserStoredProfilePayloadSource(args: {
  payload: BrowserProfilePackagePayload;
  label?: string | null;
  relays?: string[] | null;
  manualPeerPolicyOverrides?: BrowserManualPeerPolicyOverride[] | null;
}) {
  return {
    id: args.payload.profileId,
    label: args.label?.trim() || args.payload.device.name,
    relays: args.relays ?? args.payload.device.relays,
    groupPackageJson: groupJsonFromPayload(args.payload),
    sharePackageJson: shareJsonFromPayload(args.payload),
    manualPeerPolicyOverrides:
      args.manualPeerPolicyOverrides ?? args.payload.device.manualPeerPolicyOverrides,
  } satisfies BrowserStoredProfilePayloadSource;
}

function parseJsonObject(value: string, label: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error();
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid ${label}.`);
  }
}

function readStringField(
  object: Record<string, unknown>,
  snakeCaseKey: string,
  camelCaseKey: string,
) {
  const snakeCaseValue = object[snakeCaseKey];
  if (typeof snakeCaseValue === 'string') {
    return snakeCaseValue;
  }
  const camelCaseValue = object[camelCaseKey];
  return typeof camelCaseValue === 'string' ? camelCaseValue : '';
}

function readNumberField(
  object: Record<string, unknown>,
  snakeCaseKey: string,
  camelCaseKey: string,
) {
  const snakeCaseValue = object[snakeCaseKey];
  if (typeof snakeCaseValue === 'number') {
    return snakeCaseValue;
  }
  const camelCaseValue = object[camelCaseKey];
  return typeof camelCaseValue === 'number' ? camelCaseValue : 0;
}

export function reconstructBrowserProfilePackagePayload(
  profile: BrowserStoredProfilePayloadSource,
): BrowserProfilePackagePayload {
  try {
    const group = parseJsonObject(profile.groupPackageJson, 'group package JSON');
    const share = parseJsonObject(profile.sharePackageJson, 'share package JSON');

    return {
      profileId: profile.id,
      version: 1,
      device: {
        name: profile.label,
        shareSecret: normalizeHex32(
          typeof share.seckey === 'string' ? share.seckey : '',
          'share secret',
        ),
        manualPeerPolicyOverrides: profile.manualPeerPolicyOverrides ?? [],
        relays: profile.relays,
      },
      groupPackage: {
        groupName: readStringField(group, 'group_name', 'groupName') || profile.label,
        groupPk: normalizeHex32(
          readStringField(group, 'group_pk', 'groupPk'),
          'group public key',
        ),
        threshold: Math.trunc(readNumberField(group, 'threshold', 'threshold')),
        members: Array.isArray(group.members)
          ? group.members.map((member) => ({
              idx: Math.trunc(typeof member?.idx === 'number' ? member.idx : 0),
              pubkey: (() => {
                const raw = typeof member?.pubkey === 'string' ? member.pubkey : '';
                const normalized = raw.trim().toLowerCase();
                if (/^(02|03)[0-9a-f]{64}$/.test(normalized)) {
                  return normalized;
                }
                return `02${normalizeGroupMemberSharePublicKey(raw)}`;
              })(),
            }))
          : [],
      },
    };
  } catch (error) {
    logger.error('profile', 'reconstruct_failed', {
      flow_kind: 'stored_profile',
      stage: 'reconstruct',
      profile_id: profile.id,
      error_message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
