import type { BrowserManualPeerPolicyOverride } from './profile-package';
import type { SignerSettings } from './signer-settings';

/**
 * Canonical contract for a PERSISTABLE stored profile — the exact field set a
 * browser client is allowed to write to durable storage (the igloo-pwa
 * `igloo-pwa.profiles.v1` localStorage allow-list derives from it). It is the
 * single source of truth shared by the app (which builds its persist allow-list
 * from {@link PERSISTABLE_PROFILE_KEYS}) and the test harness (which types its
 * profile seeds against {@link PersistableStoredProfile}), so a test seed can
 * never set a field the app would not persist.
 *
 * Hard rule: every field here is non-secret by design. Encrypted, password-sealed
 * artifacts (e.g. `encrypted_bfshare_artifact`) are OK; cleartext secrets (raw
 * share secrets, passwords/passphrases, runtime snapshots) MUST NOT appear.
 * Default for any new profile field is NON-persisted — add it here only
 * deliberately, and never if it carries a cleartext secret.
 */
export type ProfileSource = 'generated' | 'bfprofile' | 'bfshare' | 'bfonboard';

export type PersistableStoredProfile = {
  id: string;
  label: string;
  created_at: number;
  relay_profile: string;
  state_path: string;
  group_ref: string;
  encrypted_profile_ref: string;
  relays: string[];
  group_public_key: string;
  share_public_key: string;
  group_package_json: string;
  member_idx: number;
  signer_settings: SignerSettings;
  peer_pubkey?: string | null;
  manual_peer_policy_overrides?: BrowserManualPeerPolicyOverride[];
  source: ProfileSource;
  encrypted_bfshare_artifact: string;
};

/**
 * The persistable profile keys, in storage order. Apps build their persist
 * allow-list from this list (so the keys live in exactly one place); a `satisfies`
 * binds it to {@link PersistableStoredProfile} so the list and the shape can't
 * drift apart.
 */
export const PERSISTABLE_PROFILE_KEYS = [
  'id',
  'label',
  'created_at',
  'relay_profile',
  'state_path',
  'group_ref',
  'encrypted_profile_ref',
  'relays',
  'group_public_key',
  'share_public_key',
  'group_package_json',
  'member_idx',
  'signer_settings',
  'peer_pubkey',
  'manual_peer_policy_overrides',
  'source',
  'encrypted_bfshare_artifact',
] as const satisfies readonly (keyof PersistableStoredProfile)[];
