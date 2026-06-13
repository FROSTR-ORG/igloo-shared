import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const bridgeRequiredExports = [
  'default',
  'WasmBridgeRuntime',
  'create_onboarding_request_bundle',
  'build_onboarding_runtime_snapshot',
  'create_keyset_bundle',
  'rotate_keyset_bundle',
  'derive_group_id',
];

const profileRequiredExports = [
  'default',
  'bf_package_version',
  'bfshare_prefix',
  'bfonboard_prefix',
  'bfprofile_prefix',
  'derive_profile_id_from_share_secret',
  'derive_profile_id_from_share_pubkey',
  'encode_bfprofile_package',
  'decode_bfprofile_package',
  'encode_bfshare_package',
  'decode_bfshare_package',
  'encode_bfonboard_package',
  'decode_bfonboard_package',
  'create_profile_package_pair',
];

async function loadWasmModule(moduleStem) {
  const modulePath = path.resolve(`public/wasm/${moduleStem}.js`);
  const module = await import(pathToFileURL(modulePath).href);
  const wasmPath = path.resolve(`public/wasm/${moduleStem}_bg.wasm`);
  await module.default({
    module_or_path: await readFile(wasmPath),
  });
  return module;
}

function assertExports(module, requiredExports, label) {
  const missing = requiredExports.filter((key) => !(key in module));
  if (missing.length > 0) {
    throw new Error(`Missing ${label} exports: ${missing.join(', ')}`);
  }
}

const bridgeModule = await loadWasmModule('bifrost_bridge_wasm');
assertExports(bridgeModule, bridgeRequiredExports, 'bifrost-bridge-wasm');

const profileModule = await loadWasmModule('bifrost_profile_wasm');
assertExports(profileModule, profileRequiredExports, 'bifrost-profile-wasm');

if (profileModule.bf_package_version() !== 2) {
  throw new Error(`Unexpected bf_package_version: ${profileModule.bf_package_version()}`);
}
if (profileModule.bfshare_prefix() !== 'bfshare') {
  throw new Error(`Unexpected bfshare_prefix: ${profileModule.bfshare_prefix()}`);
}
if (profileModule.bfonboard_prefix() !== 'bfonboard') {
  throw new Error(`Unexpected bfonboard_prefix: ${profileModule.bfonboard_prefix()}`);
}
if (profileModule.bfprofile_prefix() !== 'bfprofile') {
  throw new Error(`Unexpected bfprofile_prefix: ${profileModule.bfprofile_prefix()}`);
}

console.log('ok: bifrost bridge/profile wasm browser package exports are present');
