import { getPublicKey } from 'nostr-tools';

function hexToBytes(hex: string) {
  const normalized = normalizeHex32(hex, 'hex string');
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function normalizeHex32(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Invalid ${label}.`);
  }
  return normalized;
}

export function normalizeGroupMemberSharePublicKey(value: string) {
  const normalized = value.trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(normalized)) {
    return normalized;
  }
  if (/^(02|03)[0-9a-f]{64}$/.test(normalized)) {
    return normalized.slice(2);
  }
  throw new Error('Invalid group member share public key.');
}

export function publicKeyFromSecret(secretHex: string) {
  return getPublicKey(hexToBytes(secretHex)).toLowerCase();
}
