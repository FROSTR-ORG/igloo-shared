import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

// node builtins below are typed by the minimal ambient `src/node-builtins.d.ts`
// (this is the only node-only test; the package avoids a @types/node dep).

import { configureWasmProfileLoader } from './bridge-wasm-runtime';
import {
  decodeBfSharePackage,
  encodeBfSharePackage,
  type BrowserSharePackagePayload,
} from './profile-package';
import { Secret } from './secret';

// Real-cipher KATs against the checked-in bifrost_profile WASM (audit R6.5 /
// the deferred R6.3 "real browser-path crypto" piece). Every PWA/chrome unit
// harness mocks the WASM profile module, so these are the only tests anywhere
// that exercise the genuine encode/decode cipher.
//
// Node feasibility: the wasm-bindgen web-target `__wbg_init` accepts the raw
// wasm bytes via `{ module_or_path }` and instantiates them directly (no
// fetch), so we point the loader at the `.js` module and feed it bytes read off
// disk. The fixture is the committed `public/wasm` artifact; if it drifts from
// bifrost-rs the round-trip/KAT will (correctly) fail.

const loaderUrl = new URL('../public/wasm/bifrost_profile_wasm.js', import.meta.url).href;
const wasmBytes = readFileSync(
  fileURLToPath(new URL('../public/wasm/bifrost_profile_wasm_bg.wasm', import.meta.url)),
);

function sharePayload(): BrowserSharePackagePayload {
  return {
    shareSecret: '11'.repeat(32),
    relays: ['wss://relay.primal.net', 'wss://relay.damus.io'],
  };
}

beforeAll(() => {
  configureWasmProfileLoader({
    loaderImportUrl: loaderUrl,
    // `wasmBinaryUrl` is typed `string`, but the loader forwards it straight to
    // `__wbg_init({ module_or_path })`, which accepts a BufferSource and skips
    // the browser-only fetch path. Pass the bytes.
    wasmBinaryUrl: wasmBytes as unknown as string,
  });
});

describe('bfshare package real-WASM KATs', () => {
  it('round-trips a share payload through encode → decode', async () => {
    const payload = sharePayload();
    const encoded = await encodeBfSharePackage(payload, Secret.of('correct horse'));
    expect(typeof encoded).toBe('string');
    expect(encoded.startsWith('bfshare1')).toBe(true);

    const decoded = await decodeBfSharePackage(encoded, Secret.of('correct horse'));
    expect(decoded.shareSecret).toBe(payload.shareSecret);
    expect(decoded.relays).toEqual(payload.relays);
  });

  it('rejects decode under the wrong password', async () => {
    const encoded = await encodeBfSharePackage(sharePayload(), Secret.of('correct horse'));
    await expect(
      decodeBfSharePackage(encoded, Secret.of('battery staple')),
    ).rejects.toThrow();
  });

  it('rejects a single-character-corrupted package (AEAD/checksum)', async () => {
    const encoded = await encodeBfSharePackage(sharePayload(), Secret.of('correct horse'));
    // Flip one character in the middle of the bech32 body; the checksum/AEAD
    // must reject it rather than silently decode.
    const chars = [...encoded];
    const mid = Math.floor(chars.length / 2);
    chars[mid] = chars[mid] === 'q' ? 'p' : 'q';
    const corrupted = chars.join('');
    expect(corrupted).not.toBe(encoded);

    await expect(
      decodeBfSharePackage(corrupted, Secret.of('correct horse')),
    ).rejects.toThrow();
  });

  it('produces a distinct ciphertext on each encode (random salt/nonce)', async () => {
    const payload = sharePayload();
    const a = await encodeBfSharePackage(payload, Secret.of('correct horse'));
    const b = await encodeBfSharePackage(payload, Secret.of('correct horse'));
    // A fresh salt/nonce per encode means identical plaintext yields different
    // ciphertext, yet both decode back to the same payload.
    expect(a).not.toBe(b);
    expect((await decodeBfSharePackage(b, Secret.of('correct horse'))).shareSecret).toBe(
      payload.shareSecret,
    );
  });
});
