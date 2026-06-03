import { describe, expect, test, vi } from 'vitest';

import {
  createBrowserStoredProfilePayloadSource,
  createBrowserStoredProfileProjection,
  createBrowserRuntimeProfileProjection,
  createBrowserStoredRuntimeProfile,
  normalizeBrowserStoredProfilePayload,
  publicKeyFromSecret,
  reconstructBrowserProfilePackagePayload,
} from '../../index';
import { groupPackageToWireJson, sharePackageToWireJson } from '../../profile-package';

describe('browser-profile-store helpers', () => {
  test('normalizeBrowserStoredProfilePayload trims names, relays, and peer pubkeys', () => {
    const normalized = normalizeBrowserStoredProfilePayload({
      version: 1,
      profile: {
        profileId: 'profile-1',
        version: 1,
        device: {
          name: ' Device 1 ',
          shareSecret: '11'.repeat(32),
          manualPeerPolicyOverrides: [],
          relays: ['ws://relay-1', 'bad-relay'],
        },
        groupPackage: {
          groupName: ' Group 1 ',
          groupPk: '33'.repeat(32),
          threshold: 2,
          members: [{ idx: 1, pubkey: `02${publicKeyFromSecret('11'.repeat(32))}` }],
        },
      },
      signerSettings: { sign_timeout_secs: 12 },
      peerPubkey: ` ${'AA'.repeat(32)} `,
      runtimeSnapshotJson: '  {"state":"ok"}  ',
    });

    expect(normalized.profile.device.name).toBe('Device 1');
    expect(normalized.profile.device.relays).toEqual(['ws://relay-1']);
    expect(normalized.peerPubkey).toBe('aa'.repeat(32));
    expect(normalized.runtimeSnapshotJson).toBe('  {"state":"ok"}  ');
    expect(normalized.signerSettings.sign_timeout_secs).toBe(12);
  });

  test('createBrowserStoredProfileProjection returns preview, summary, and artifact refs', () => {
    const payload = {
      profileId: 'profile-2',
      version: 1,
      device: {
        name: 'Device 2',
        shareSecret: '22'.repeat(32),
        manualPeerPolicyOverrides: [],
        relays: ['ws://relay-2'],
      },
      groupPackage: {
        groupName: 'Group 2',
        groupPk: '44'.repeat(32),
        threshold: 2,
        members: [{ idx: 1, pubkey: `02${publicKeyFromSecret('22'.repeat(32))}` }],
      },
    };

    const projection = createBrowserStoredProfileProjection({
      payload,
      source: 'bfprofile',
      signerSettings: { ping_timeout_secs: 9 },
    });

    expect(projection.preview).toEqual(
      expect.objectContaining({
        label: 'Device 2',
        source: 'bfprofile',
      }),
    );
    expect(projection.summary).toEqual(
      expect.objectContaining({
        id: 'profile-2',
        groupPublicKey: '44'.repeat(32),
        sharePublicKey: publicKeyFromSecret('22'.repeat(32)),
      }),
    );
    expect(projection.artifactRefs).toEqual({
      groupRef: 'browser-profile:profile-2:group',
      encryptedProfileRef: 'browser-profile:profile-2:encrypted-profile',
      statePath: 'browser-profile:profile-2:state',
    });
  });

  test('createBrowserStoredRuntimeProfile returns the normalized shared summary shape', () => {
    const summary = createBrowserStoredRuntimeProfile({
      version: 1,
      profile: {
        profileId: 'profile-3',
        version: 1,
        device: {
          name: ' Device 3 ',
          shareSecret: '33'.repeat(32),
          manualPeerPolicyOverrides: [],
          relays: ['ws://relay-3'],
        },
        groupPackage: {
          groupName: ' Group 3 ',
          groupPk: '55'.repeat(32),
          threshold: 2,
          members: [{ idx: 1, pubkey: `02${publicKeyFromSecret('33'.repeat(32))}` }],
        },
      },
      signerSettings: { request_ttl_secs: 45 },
    });

    expect(summary).toEqual(
      expect.objectContaining({
        id: 'profile-3',
        label: 'Device 3',
        groupName: 'Group 3',
        relays: ['ws://relay-3'],
        groupPublicKey: '55'.repeat(32),
      }),
    );
    expect(summary.signerSettings.request_ttl_secs).toBe(45);
  });

  test('reconstructBrowserProfilePackagePayload rebuilds the canonical package payload', () => {
    const payload = reconstructBrowserProfilePackagePayload({
      id: 'profile-4',
      label: 'Device 4',
      relays: ['ws://relay-4'],
      groupPackageJson: groupPackageToWireJson({
        groupName: 'Group 4',
        groupPk: '66'.repeat(32),
        threshold: 2,
        members: [{ idx: 1, pubkey: `02${publicKeyFromSecret('44'.repeat(32))}` }],
      }),
      sharePackageJson: sharePackageToWireJson(1, '44'.repeat(32)),
      manualPeerPolicyOverrides: [],
    });

    expect(payload).toEqual({
      profileId: 'profile-4',
      version: 1,
      device: {
        name: 'Device 4',
        shareSecret: '44'.repeat(32),
        manualPeerPolicyOverrides: [],
        relays: ['ws://relay-4'],
      },
      groupPackage: {
        groupName: 'Group 4',
        groupPk: '66'.repeat(32),
        threshold: 2,
        members: [{ idx: 1, pubkey: `02${publicKeyFromSecret('44'.repeat(32))}` }],
      },
    });
  });

  test('reconstructBrowserProfilePackagePayload accepts browser payload JSON with camelCase keys', () => {
    const payload = reconstructBrowserProfilePackagePayload({
      id: 'profile-4b',
      label: 'Device 4b',
      relays: ['ws://relay-4b'],
      groupPackageJson: JSON.stringify({
        groupName: 'Group 4b',
        groupPk: '67'.repeat(32),
        threshold: 2,
        members: [{ idx: 1, pubkey: `02${publicKeyFromSecret('45'.repeat(32))}` }],
      }),
      sharePackageJson: JSON.stringify({
        idx: 1,
        seckey: '45'.repeat(32),
      }),
      manualPeerPolicyOverrides: [],
    });

    expect(payload).toEqual({
      profileId: 'profile-4b',
      version: 1,
      device: {
        name: 'Device 4b',
        shareSecret: '45'.repeat(32),
        manualPeerPolicyOverrides: [],
        relays: ['ws://relay-4b'],
      },
      groupPackage: {
        groupName: 'Group 4b',
        groupPk: '67'.repeat(32),
        threshold: 2,
        members: [{ idx: 1, pubkey: `02${publicKeyFromSecret('45'.repeat(32))}` }],
      },
    });
  });

  test('reconstructBrowserProfilePackagePayload emits a structured error event on invalid JSON', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() =>
      reconstructBrowserProfilePackagePayload({
        id: 'profile-bad',
        label: 'Broken Device',
        relays: ['ws://relay-bad'],
        groupPackageJson: '{bad',
        sharePackageJson: sharePackageToWireJson(1, '45'.repeat(32)),
        manualPeerPolicyOverrides: [],
      }),
    ).toThrow(/Invalid group package JSON/);

    const lastErrorCall = errorSpy.mock.calls[errorSpy.mock.calls.length - 1];
    const event = JSON.parse(String(lastErrorCall?.[0] ?? '{}'));
    expect(event).toEqual(
      expect.objectContaining({
        domain: 'profile',
        event: 'reconstruct_failed',
        flow_kind: 'stored_profile',
        stage: 'reconstruct',
        profile_id: 'profile-bad',
      }),
    );
    errorSpy.mockRestore();
  });

  test('createBrowserStoredProfilePayloadSource emits canonical stored profile JSON', () => {
    const source = createBrowserStoredProfilePayloadSource({
      payload: {
        profileId: 'profile-4c',
        version: 1,
        device: {
          name: 'Device 4c',
          shareSecret: '46'.repeat(32),
          manualPeerPolicyOverrides: [],
          relays: ['ws://relay-4c'],
        },
        groupPackage: {
          groupName: 'Group 4c',
          groupPk: '68'.repeat(32),
          threshold: 2,
          members: [{ idx: 1, pubkey: `02${publicKeyFromSecret('46'.repeat(32))}` }],
        },
      },
    });

    expect(source).toEqual(
      expect.objectContaining({
        id: 'profile-4c',
        label: 'Device 4c',
        relays: ['ws://relay-4c'],
      }),
    );
    expect(JSON.parse(source.groupPackageJson)).toEqual({
      group_name: 'Group 4c',
      group_pk: '68'.repeat(32),
      threshold: 2,
      members: [{ idx: 1, pubkey: `02${publicKeyFromSecret('46'.repeat(32))}` }],
    });
    expect(JSON.parse(source.sharePackageJson)).toEqual({
      idx: 1,
      seckey: '46'.repeat(32),
    });
  });

  test('createBrowserRuntimeProfileProjection rebuilds runtime profile shape from a stored profile source', () => {
    const projection = createBrowserRuntimeProfileProjection({
      profile: {
        id: 'profile-5',
        label: 'Device 5',
        relays: ['ws://relay-5'],
        groupPackageJson: groupPackageToWireJson({
          groupName: 'Group 5',
          groupPk: '77'.repeat(32),
          threshold: 2,
          members: [{ idx: 1, pubkey: `02${publicKeyFromSecret('55'.repeat(32))}` }],
        }),
        sharePackageJson: sharePackageToWireJson(1, '55'.repeat(32)),
        manualPeerPolicyOverrides: [],
        peerPubkey: 'aa'.repeat(32),
      },
      signerSettings: { ping_timeout_secs: 12 },
      runtimeSnapshotJson: '{"runtime":"ok"}',
      peerPermissionStates: [
        {
          pubkey: 'bb'.repeat(32),
          manual_override: {
            request: { ping: 'allow', onboard: 'unset', sign: 'unset', ecdh: 'unset' },
            respond: { ping: 'unset', onboard: 'deny', sign: 'unset', ecdh: 'unset' },
          },
          remote_observation: null,
          effective_policy: {
            request: { ping: true, onboard: true, sign: true, ecdh: true },
            respond: { ping: true, onboard: true, sign: true, ecdh: true },
          },
        },
      ],
    });

    expect(projection.summary).toEqual(
      expect.objectContaining({
        id: 'profile-5',
        label: 'Device 5',
        peerPubkey: 'aa'.repeat(32),
        runtimeSnapshotJson: '{"runtime":"ok"}',
      }),
    );
    expect(projection.manualPeerPolicyOverrides).toEqual([
      expect.objectContaining({
        pubkey: 'bb'.repeat(32),
        policy: expect.objectContaining({
          request: expect.objectContaining({ ping: 'allow' }),
          respond: expect.objectContaining({ onboard: 'deny' }),
        }),
      }),
    ]);
  });
});
