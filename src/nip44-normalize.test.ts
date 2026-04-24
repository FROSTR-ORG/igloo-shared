import { describe, expect, test } from 'vitest';

import {
  MAX_NIP44_PAYLOAD_LEN,
  Nip44NormalizeError,
  normalizeNip44PayloadForJs,
  normalizeNip44PayloadForRust,
} from './nip44-normalize';

describe('D.6 nip44 normalize', () => {
  describe('normalizeNip44PayloadForJs', () => {
    test('pads canonical base64 to a multiple of four', () => {
      // 11 characters → pad by 1 to reach 12.
      expect(normalizeNip44PayloadForJs('AAAABBBBCCC')).toBe('AAAABBBBCCC=');
      // 10 characters → pad by 2.
      expect(normalizeNip44PayloadForJs('AAAABBBBCC')).toBe('AAAABBBBCC==');
      // 8 characters → already aligned.
      expect(normalizeNip44PayloadForJs('AAAABBBB')).toBe('AAAABBBB');
    });

    test('invalid_base64_rejected_before_decrypt', () => {
      // base64url alphabet chars (-, _) must NOT be accepted; NIP-44 payloads
      // are canonical base64 only.
      expect(() => normalizeNip44PayloadForJs('abc-def_==')).toThrow(
        Nip44NormalizeError,
      );
      expect(() => normalizeNip44PayloadForJs('hello world!')).toThrow(
        Nip44NormalizeError,
      );
      expect(() => normalizeNip44PayloadForJs('AAAA\nAAAA')).toThrow(
        Nip44NormalizeError,
      );

      try {
        normalizeNip44PayloadForJs('abc-def');
        throw new Error('expected throw');
      } catch (error) {
        expect(error).toBeInstanceOf(Nip44NormalizeError);
        const typed = error as Nip44NormalizeError;
        expect(typed.reason).toBe('invalid_base64');
        expect(typed.message).toBe('nip44_normalize_invalid_base64');
        expect(typed.payloadLength).toBe(7);
      }
    });

    test('empty payload rejected', () => {
      try {
        normalizeNip44PayloadForJs('   ');
        throw new Error('expected throw');
      } catch (error) {
        expect(error).toBeInstanceOf(Nip44NormalizeError);
        expect((error as Nip44NormalizeError).reason).toBe('payload_empty');
      }
    });

    test('oversized payload rejected above MAX_NIP44_PAYLOAD_LEN', () => {
      const tooLong = 'A'.repeat(MAX_NIP44_PAYLOAD_LEN + 1);
      try {
        normalizeNip44PayloadForJs(tooLong);
        throw new Error('expected throw');
      } catch (error) {
        expect(error).toBeInstanceOf(Nip44NormalizeError);
        const typed = error as Nip44NormalizeError;
        expect(typed.reason).toBe('payload_too_long');
        expect(typed.payloadLength).toBe(MAX_NIP44_PAYLOAD_LEN + 1);
      }
    });

    test('MAX_NIP44_PAYLOAD_LEN boundary is inclusive', () => {
      // A payload exactly at the cap (padded to %4 == 0) must succeed.
      const justFits = 'A'.repeat(MAX_NIP44_PAYLOAD_LEN);
      const out = normalizeNip44PayloadForJs(justFits);
      expect(out.length % 4).toBe(0);
    });

    test('trims surrounding whitespace before validation', () => {
      expect(normalizeNip44PayloadForJs('  AAAA  ')).toBe('AAAA');
    });
  });

  describe('normalizeNip44PayloadForRust', () => {
    test('strips trailing padding', () => {
      expect(normalizeNip44PayloadForRust('AAAA==')).toBe('AAAA');
      expect(normalizeNip44PayloadForRust(' AAAA= ')).toBe('AAAA');
    });
  });

  describe('gate ordering — composition with nip44.v2.decrypt', () => {
    test('invalid_base64_rejected_before_decrypt', () => {
      // `nip44.v2.decrypt(normalizeNip44PayloadForJs(ciphertext), key)`
      // is the canonical call site. An invalid-base64 ciphertext throws
      // at normalize time — decrypt is never reached. We express that by
      // verifying the decryptCall fn is NEVER invoked when the outer
      // normalize call throws.
      const decryptCall = (..._args: unknown[]): string => {
        throw new Error('decrypt_should_not_have_been_called');
      };
      expect(() =>
        decryptCall(normalizeNip44PayloadForJs('abc-def_invalid')),
      ).toThrow(Nip44NormalizeError);
    });
  });
});
