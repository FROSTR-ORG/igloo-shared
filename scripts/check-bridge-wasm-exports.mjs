import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const requiredExports = [
  'default',
  'WasmBridgeRuntime',
  'bf_package_version',
  'bfshare_prefix',
  'bfonboard_prefix',
  'bfprofile_prefix',
  'profile_backup_event_kind',
  'profile_backup_key_domain',
  'encode_bfshare_package',
  'decode_bfshare_package',
  'encode_bfonboard_package',
  'decode_bfonboard_package',
  'create_onboarding_request_bundle',
  'build_onboarding_runtime_snapshot',
  'encode_bfprofile_package',
  'decode_bfprofile_package',
  'create_profile_package_pair',
  'create_encrypted_profile_backup',
  'derive_profile_backup_conversation_key_hex',
  'encrypt_profile_backup_content',
  'decrypt_profile_backup_content',
  'build_profile_backup_event',
  'parse_profile_backup_event',
];

const modulePath = path.resolve('public/wasm/bifrost_bridge_wasm.js');
const bridgeModule = await import(pathToFileURL(modulePath).href);
const wasmPath = path.resolve('public/wasm/bifrost_bridge_wasm_bg.wasm');

const missing = requiredExports.filter((key) => !(key in bridgeModule));
if (missing.length > 0) {
  throw new Error(`Missing bifrost-bridge-wasm exports: ${missing.join(', ')}`);
}

await bridgeModule.default({
  module_or_path: await readFile(wasmPath),
});

if (bridgeModule.bf_package_version() !== 1) {
  throw new Error(`Unexpected bf_package_version: ${bridgeModule.bf_package_version()}`);
}
if (bridgeModule.bfshare_prefix() !== 'bfshare') {
  throw new Error(`Unexpected bfshare_prefix: ${bridgeModule.bfshare_prefix()}`);
}
if (bridgeModule.bfonboard_prefix() !== 'bfonboard') {
  throw new Error(`Unexpected bfonboard_prefix: ${bridgeModule.bfonboard_prefix()}`);
}
if (bridgeModule.bfprofile_prefix() !== 'bfprofile') {
  throw new Error(`Unexpected bfprofile_prefix: ${bridgeModule.bfprofile_prefix()}`);
}
if (bridgeModule.profile_backup_event_kind() !== 10000) {
  throw new Error(
    `Unexpected profile_backup_event_kind: ${bridgeModule.profile_backup_event_kind()}`,
  );
}
if (bridgeModule.profile_backup_key_domain() !== 'frostr-profile-backup/v1') {
  throw new Error(
    `Unexpected profile_backup_key_domain: ${bridgeModule.profile_backup_key_domain()}`,
  );
}

console.log('ok: bifrost-bridge-wasm browser package exports are present');
