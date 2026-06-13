import { describe, expect, test, vi } from 'vitest';

vi.mock('../../profile-package', async () => {
  const actual = await vi.importActual<typeof import('../../profile-package')>('../../profile-package');
  return {
    ...actual,
    deriveProfileIdFromShareSecret: vi.fn(async (shareSecret: string) => `profile-${shareSecret.slice(0, 8)}`),
  };
});

import { createBrowserRuntimeNodeInit, runtimePayloadFromSnapshot } from '../../index';

describe('browser-runtime-session helpers', () => {
  test('createBrowserRuntimeNodeInit returns persisted config when a snapshot exists', () => {
    const init = createBrowserRuntimeNodeInit({
      relays: ['ws://relay-1'],
      signerSettings: { ping_timeout_secs: 8 },
      runtimeSnapshotJson: '{"state":"ok"}',
    });

    expect(init).toEqual({
      config: {
        mode: 'persisted',
        relays: ['ws://relay-1'],
        signerSettings: expect.objectContaining({ ping_timeout_secs: 8 }),
      },
      restoreOptions: {
        runtimeSnapshotJson: '{"state":"ok"}',
      },
    });
  });

  test('createBrowserRuntimeNodeInit carries fallback packages alongside a persisted snapshot', () => {
    const init = createBrowserRuntimeNodeInit({
      relays: ['ws://relay-1'],
      signerSettings: { ping_timeout_secs: 8 },
      peerPubkey: 'bb'.repeat(32),
      runtimeSnapshotJson: '{"state":"ok"}',
      groupPackageJson: '{"group_name":"Group"}',
      sharePackageJson: '{"idx":1,"seckey":"11"}',
    });

    expect(init.config.mode).toBe('persisted');
    expect(init.restoreOptions).toEqual({ runtimeSnapshotJson: '{"state":"ok"}' });
    // The packages ride along so the bridge can re-bootstrap from them if the
    // snapshot fails to restore (resilient restore).
    expect(init.config).toMatchObject({
      groupPackageJson: '{"group_name":"Group"}',
      sharePackageJson: '{"idx":1,"seckey":"11"}',
      bootstrapPeerPubkey32Hex: 'bb'.repeat(32),
    });
  });

  test('createBrowserRuntimeNodeInit discards a corrupt snapshot and falls through to profile config', () => {
    const init = createBrowserRuntimeNodeInit({
      relays: ['ws://relay-3'],
      signerSettings: { sign_timeout_secs: 14 },
      // A truncated/corrupt snapshot must not reach the WASM restore path.
      runtimeSnapshotJson: '{"state":"ok"', // missing closing brace
      groupPackageJson: '{"group_name":"Group"}',
      sharePackageJson: '{"idx":1,"seckey":"11"}',
    });

    expect(init.config.mode).toBe('profile');
    expect(init.restoreOptions).toBeUndefined();
  });

  test('createBrowserRuntimeNodeInit returns profile config when bootstrap packages are present', () => {
    const init = createBrowserRuntimeNodeInit({
      relays: ['ws://relay-2'],
      signerSettings: { sign_timeout_secs: 14 },
      peerPubkey: 'aa'.repeat(32),
      groupPackageJson: '{"group_name":"Group"}',
      sharePackageJson: '{"idx":1,"seckey":"11"}',
    });

    expect(init).toEqual({
      config: {
        mode: 'profile',
        relays: ['ws://relay-2'],
        signerSettings: expect.objectContaining({ sign_timeout_secs: 14 }),
        bootstrapPeerPubkey32Hex: 'aa'.repeat(32),
        groupPackageJson: '{"group_name":"Group"}',
        sharePackageJson: '{"idx":1,"seckey":"11"}',
      },
    });
  });

  test('runtimePayloadFromSnapshot rebuilds a profile payload from snapshot JSON', async () => {
    const payload = await runtimePayloadFromSnapshot({
      label: ' Restored Device ',
      relays: ['ws://relay-3'],
      runtimeSnapshotJson: JSON.stringify({
        bootstrap: {
          group: {
            group_pk: '33'.repeat(32),
            threshold: 2,
            members: [
              { idx: 1, pubkey: '02' + '11'.repeat(32) },
              { idx: 2, pubkey: '03' + '22'.repeat(32) },
            ],
          },
          share: {
            seckey: '11'.repeat(32),
          },
        },
      }),
    });

    expect(payload.profileId).toBe('profile-11111111');
    expect(payload.device.name).toBe('Restored Device');
    expect(payload.groupPackage.groupName).toBe('Restored Device');
  });
});
