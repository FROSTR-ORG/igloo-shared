import { describe, expect, it } from 'vitest';
import { publicKeyFromSecret } from './keys';
import { createBrowserProfilePreview, onboardPreviewDisplayMeta } from './preview';
import type { BrowserProfilePackagePayload } from '../../profile-package';

const shareSecret = '11'.repeat(32);

function fixturePayload(): BrowserProfilePackagePayload {
  return {
    profileId: 'test-profile-id',
    version: 1,
    device: {
      name: 'My Device',
      shareSecret,
      manualPeerPolicyOverrides: [],
      relays: ['wss://relay.example'],
    },
    groupPackage: {
      groupName: 'Acme Keyset',
      groupPk: `02${publicKeyFromSecret(shareSecret)}`,
      threshold: 2,
      members: [
        { idx: 0, pubkey: `02${publicKeyFromSecret('22'.repeat(32))}` },
        { idx: 1, pubkey: `02${publicKeyFromSecret(shareSecret)}` },
        { idx: 2, pubkey: `02${publicKeyFromSecret('33'.repeat(32))}` },
      ],
    },
  };
}

describe('onboardPreviewDisplayMeta', () => {
  it('derives keyset name, threshold label, and share index from the preview', () => {
    const preview = createBrowserProfilePreview(fixturePayload(), 'onboard');
    const meta = onboardPreviewDisplayMeta(preview);
    expect(meta.keysetName).toBe('Acme Keyset');
    expect(meta.thresholdLabel).toBe('2/3');
    expect(meta.shareLabel).toBe('Share #1');
  });

  it('falls back to a generic share label when the share is not a group member', () => {
    const preview = createBrowserProfilePreview(fixturePayload(), 'onboard');
    const orphaned = { ...preview, share_public_key: 'f'.repeat(64) };
    expect(onboardPreviewDisplayMeta(orphaned).shareLabel).toBe('Share');
  });
});
