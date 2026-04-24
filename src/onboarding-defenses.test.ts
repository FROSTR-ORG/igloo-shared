import { describe, expect, test } from 'vitest';

import {
  MAX_ONBOARDING_DECRYPTS,
  createOnboardingDecryptCounter,
  recordOnboardingDecryptAttempt,
  validateOnboardingGroup,
} from './browser-runtime-core';

const SHARE_X_ONLY = 'aa'.repeat(32);
const SHARE_COMPRESSED = `02${SHARE_X_ONLY}`;
const PEER_X_ONLY = 'bb'.repeat(32);
const PEER_COMPRESSED = `03${PEER_X_ONLY}`;

describe('D.6 onboarding decrypt defenses', () => {
  describe('recordOnboardingDecryptAttempt', () => {
    test('decrypt_cap_rejects_after_50_attempts', () => {
      // Simulate 51 adversarial relay events: the first 50 consume budget,
      // the 51st is refused with a single `cap_reached_first` signal.
      const counter = createOnboardingDecryptCounter();

      for (let i = 0; i < MAX_ONBOARDING_DECRYPTS; i++) {
        expect(recordOnboardingDecryptAttempt(counter)).toBe('allow');
      }

      expect(counter.attempts).toBe(MAX_ONBOARDING_DECRYPTS);
      expect(counter.capWarned).toBe(false);

      // 51st attempt trips the cap. The caller emits
      // `decrypt_cap_reached` exactly once on this outcome.
      expect(recordOnboardingDecryptAttempt(counter)).toBe('cap_reached_first');
      expect(counter.capWarned).toBe(true);
      expect(counter.attempts).toBe(MAX_ONBOARDING_DECRYPTS);

      // Subsequent refusals do NOT re-emit the warning event.
      expect(recordOnboardingDecryptAttempt(counter)).toBe('cap_reached');
      expect(recordOnboardingDecryptAttempt(counter)).toBe('cap_reached');
    });

    test('counter state is per-instance and resets with a new counter', () => {
      // Rate limit is keyed by onboarding request, not globally: a fresh
      // counter for a retry starts with full budget.
      const a = createOnboardingDecryptCounter();
      for (let i = 0; i < MAX_ONBOARDING_DECRYPTS; i++) {
        recordOnboardingDecryptAttempt(a);
      }
      expect(recordOnboardingDecryptAttempt(a)).toBe('cap_reached_first');

      const b = createOnboardingDecryptCounter();
      expect(recordOnboardingDecryptAttempt(b)).toBe('allow');
    });

    test('respects custom max for testing', () => {
      const counter = createOnboardingDecryptCounter();
      expect(recordOnboardingDecryptAttempt(counter, 2)).toBe('allow');
      expect(recordOnboardingDecryptAttempt(counter, 2)).toBe('allow');
      expect(recordOnboardingDecryptAttempt(counter, 2)).toBe(
        'cap_reached_first',
      );
    });
  });

  describe('validateOnboardingGroup', () => {
    test('accepts a well-formed group descriptor', () => {
      const result = validateOnboardingGroup(
        {
          group_pk: '33'.repeat(32),
          threshold: 2,
          members: [
            { idx: 1, pubkey: SHARE_COMPRESSED },
            { idx: 2, pubkey: PEER_COMPRESSED },
          ],
        },
        SHARE_X_ONLY,
      );
      expect(result).toEqual({
        kind: 'ok',
        memberCount: 2,
        threshold: 2,
      });
    });

    test('accepts x-only and compressed pubkey member encodings', () => {
      // Member list mixes 32-byte and 33-byte encodings; membership match
      // is on the trailing 32-byte component.
      const result = validateOnboardingGroup(
        {
          threshold: 1,
          members: [{ idx: 1, pubkey: SHARE_X_ONLY }],
        },
        SHARE_X_ONLY,
      );
      expect(result.kind).toBe('ok');
    });

    test('peer_not_in_group_rejected', () => {
      const result = validateOnboardingGroup(
        {
          threshold: 1,
          members: [{ idx: 1, pubkey: PEER_COMPRESSED }],
        },
        SHARE_X_ONLY,
      );
      expect(result).toEqual({ kind: 'peer_not_in_group' });
    });

    test('duplicate_members_rejected', () => {
      const result = validateOnboardingGroup(
        {
          threshold: 1,
          members: [
            { idx: 1, pubkey: SHARE_COMPRESSED },
            { idx: 2, pubkey: SHARE_COMPRESSED },
          ],
        },
        SHARE_X_ONLY,
      );
      expect(result).toEqual({ kind: 'duplicate_members' });
    });

    test('threshold_out_of_bounds_rejected — threshold 0', () => {
      const result = validateOnboardingGroup(
        {
          threshold: 0,
          members: [
            { idx: 1, pubkey: SHARE_COMPRESSED },
            { idx: 2, pubkey: PEER_COMPRESSED },
          ],
        },
        SHARE_X_ONLY,
      );
      expect(result).toEqual({ kind: 'bad_threshold' });
    });

    test('threshold_out_of_bounds_rejected — threshold > members.length', () => {
      const result = validateOnboardingGroup(
        {
          threshold: 3,
          members: [
            { idx: 1, pubkey: SHARE_COMPRESSED },
            { idx: 2, pubkey: PEER_COMPRESSED },
          ],
        },
        SHARE_X_ONLY,
      );
      expect(result).toEqual({ kind: 'bad_threshold' });
    });

    test('threshold must be an integer', () => {
      for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, '2']) {
        const result = validateOnboardingGroup(
          {
            threshold: bad,
            members: [{ idx: 1, pubkey: SHARE_COMPRESSED }],
          },
          SHARE_X_ONLY,
        );
        expect(result).toEqual({ kind: 'bad_threshold' });
      }
    });

    test('malformed descriptors fall through to `malformed`', () => {
      expect(validateOnboardingGroup(null, SHARE_X_ONLY)).toEqual({
        kind: 'malformed',
      });
      expect(validateOnboardingGroup({}, SHARE_X_ONLY)).toEqual({
        kind: 'malformed',
      });
      expect(
        validateOnboardingGroup({ members: [] }, SHARE_X_ONLY),
      ).toEqual({ kind: 'malformed' });
      // member entry without a pubkey string
      expect(
        validateOnboardingGroup(
          { threshold: 1, members: [{ idx: 1 }] },
          SHARE_X_ONLY,
        ),
      ).toEqual({ kind: 'malformed' });
      // non-array members
      expect(
        validateOnboardingGroup(
          { threshold: 1, members: 'oops' },
          SHARE_X_ONLY,
        ),
      ).toEqual({ kind: 'malformed' });
    });

    test('validation outcomes are stable against trailing fields', () => {
      // Unknown fields on the group object must not change the outcome —
      // we only care about shape, membership, and threshold.
      const result = validateOnboardingGroup(
        {
          threshold: 1,
          members: [{ idx: 1, pubkey: SHARE_COMPRESSED, extra: 'ignored' }],
          future_field: { nested: true },
        },
        SHARE_X_ONLY,
      );
      expect(result.kind).toBe('ok');
    });
  });
});
