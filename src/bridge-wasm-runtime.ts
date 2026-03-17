export type WasmBridgeRuntimeApi = {
  init_runtime: (configJson: string, bootstrapJson: string) => void;
  restore_runtime: (configJson: string, snapshotJson: string) => void;
  handle_command: (commandJson: string) => void;
  handle_inbound_event: (eventJson: string) => void;
  tick: (nowUnixMs: number) => void;
  drain_outbound_events: () => string;
  drain_completions: () => string;
  drain_failures: () => string;
  snapshot_state: () => string;
  status: () => string;
  peer_permission_states: () => string;
  read_config: () => string;
  update_config: (configPatchJson: string) => void;
  peer_status: () => string;
  readiness: () => string;
  runtime_status: () => string;
  runtime_diagnostics: () => string;
  drain_runtime_events: () => string;
  wipe_state: () => void;
  runtime_metadata: () => string;
  set_policy_override: (policyJson: string) => void;
  clear_policy_overrides: () => void;
};

export type WasmProfilePackageApi = {
  bf_package_version: () => number;
  bfshare_prefix: () => string;
  bfonboard_prefix: () => string;
  bfprofile_prefix: () => string;
  profile_backup_event_kind: () => number;
  profile_backup_key_domain: () => string;
  encode_bfshare_package: (payloadJson: string, password: string) => string;
  decode_bfshare_package: (packageText: string, password: string) => string;
  encode_bfonboard_package: (payloadJson: string, password: string) => string;
  decode_bfonboard_package: (packageText: string, password: string) => string;
  create_onboarding_request_bundle: (
    shareSecret: string,
    peerPubkey32Hex: string,
    eventKind: number,
    sentAtSeconds?: number | null,
  ) => string;
  build_onboarding_runtime_snapshot: (
    groupJson: string,
    shareSecret: string,
    peerPubkey32Hex: string,
    responseNoncesJson: string,
    bootstrapStateHex: string,
  ) => string;
  derive_profile_id_from_share_secret: (shareSecret: string) => string;
  derive_profile_id_from_share_pubkey: (sharePubkey: string) => string;
  encode_bfprofile_package: (payloadJson: string, password: string) => string;
  decode_bfprofile_package: (packageText: string, password: string) => string;
  create_profile_package_pair: (payloadJson: string, password: string) => string;
  create_encrypted_profile_backup: (profileJson: string) => string;
  derive_profile_backup_conversation_key_hex: (shareSecret: string) => string;
  encrypt_profile_backup_content: (backupJson: string, shareSecret: string) => string;
  decrypt_profile_backup_content: (ciphertext: string, shareSecret: string) => string;
  build_profile_backup_event: (
    shareSecret: string,
    backupJson: string,
    createdAtSeconds?: number | null,
  ) => string;
  parse_profile_backup_event: (eventJson: string, shareSecret: string) => string;
};

export type WasmKeysetApi = {
  create_keyset_bundle: (configJson: string) => string;
};

type WasmBridgeModule = {
  WasmBridgeRuntime: new () => {
    init_runtime: (configJson: string, bootstrapJson: string) => void;
    restore_runtime: (configJson: string, snapshotJson: string) => void;
    handle_command: (commandJson: string) => void;
    handle_inbound_event: (eventJson: string) => void;
    tick: (nowUnixMs: bigint) => void;
    drain_outbound_events: () => string;
    drain_completions: () => string;
    drain_failures: () => string;
    snapshot_state: () => string;
    status: () => string;
    peer_permission_states: () => string;
    read_config: () => string;
    update_config: (configPatchJson: string) => void;
    peer_status: () => string;
    readiness: () => string;
    runtime_status: () => string;
    runtime_diagnostics: () => string;
    drain_runtime_events: () => string;
    wipe_state: () => void;
    runtime_metadata: () => string;
    set_policy_override: (policyJson: string) => void;
    clear_policy_overrides: () => void;
  };
  bf_package_version: WasmProfilePackageApi['bf_package_version'];
  bfshare_prefix: WasmProfilePackageApi['bfshare_prefix'];
  bfonboard_prefix: WasmProfilePackageApi['bfonboard_prefix'];
  bfprofile_prefix: WasmProfilePackageApi['bfprofile_prefix'];
  profile_backup_event_kind: WasmProfilePackageApi['profile_backup_event_kind'];
  profile_backup_key_domain: WasmProfilePackageApi['profile_backup_key_domain'];
  encode_bfshare_package: WasmProfilePackageApi['encode_bfshare_package'];
  decode_bfshare_package: WasmProfilePackageApi['decode_bfshare_package'];
  encode_bfonboard_package: WasmProfilePackageApi['encode_bfonboard_package'];
  decode_bfonboard_package: WasmProfilePackageApi['decode_bfonboard_package'];
  create_onboarding_request_bundle: (
    shareSecret: string,
    peerPubkey32Hex: string,
    eventKind: bigint,
    sentAtSeconds?: number | null,
  ) => string;
  build_onboarding_runtime_snapshot: WasmProfilePackageApi['build_onboarding_runtime_snapshot'];
  derive_profile_id_from_share_secret: WasmProfilePackageApi['derive_profile_id_from_share_secret'];
  derive_profile_id_from_share_pubkey: WasmProfilePackageApi['derive_profile_id_from_share_pubkey'];
  encode_bfprofile_package: WasmProfilePackageApi['encode_bfprofile_package'];
  decode_bfprofile_package: WasmProfilePackageApi['decode_bfprofile_package'];
  create_profile_package_pair: WasmProfilePackageApi['create_profile_package_pair'];
  create_encrypted_profile_backup: WasmProfilePackageApi['create_encrypted_profile_backup'];
  derive_profile_backup_conversation_key_hex: WasmProfilePackageApi['derive_profile_backup_conversation_key_hex'];
  encrypt_profile_backup_content: WasmProfilePackageApi['encrypt_profile_backup_content'];
  decrypt_profile_backup_content: WasmProfilePackageApi['decrypt_profile_backup_content'];
  build_profile_backup_event: WasmProfilePackageApi['build_profile_backup_event'];
  parse_profile_backup_event: WasmProfilePackageApi['parse_profile_backup_event'];
  create_keyset_bundle: WasmKeysetApi['create_keyset_bundle'];
};

type WasmBridgeLoaderModule = {
  default: (options?: { module_or_path?: string | URL | ArrayBuffer | ArrayBufferView }) => Promise<unknown>;
  WasmBridgeRuntime?: WasmBridgeModule['WasmBridgeRuntime'];
  bf_package_version?: WasmBridgeModule['bf_package_version'];
  bfshare_prefix?: WasmBridgeModule['bfshare_prefix'];
  bfonboard_prefix?: WasmBridgeModule['bfonboard_prefix'];
  bfprofile_prefix?: WasmBridgeModule['bfprofile_prefix'];
  profile_backup_event_kind?: WasmBridgeModule['profile_backup_event_kind'];
  profile_backup_key_domain?: WasmBridgeModule['profile_backup_key_domain'];
  encode_bfshare_package?: WasmBridgeModule['encode_bfshare_package'];
  decode_bfshare_package?: WasmBridgeModule['decode_bfshare_package'];
  encode_bfonboard_package?: WasmBridgeModule['encode_bfonboard_package'];
  decode_bfonboard_package?: WasmBridgeModule['decode_bfonboard_package'];
  create_onboarding_request_bundle?: WasmBridgeModule['create_onboarding_request_bundle'];
  build_onboarding_runtime_snapshot?: WasmBridgeModule['build_onboarding_runtime_snapshot'];
  derive_profile_id_from_share_secret?: WasmBridgeModule['derive_profile_id_from_share_secret'];
  derive_profile_id_from_share_pubkey?: WasmBridgeModule['derive_profile_id_from_share_pubkey'];
  encode_bfprofile_package?: WasmBridgeModule['encode_bfprofile_package'];
  decode_bfprofile_package?: WasmBridgeModule['decode_bfprofile_package'];
  create_profile_package_pair?: WasmBridgeModule['create_profile_package_pair'];
  create_encrypted_profile_backup?: WasmBridgeModule['create_encrypted_profile_backup'];
  derive_profile_backup_conversation_key_hex?: WasmBridgeModule['derive_profile_backup_conversation_key_hex'];
  encrypt_profile_backup_content?: WasmBridgeModule['encrypt_profile_backup_content'];
  decrypt_profile_backup_content?: WasmBridgeModule['decrypt_profile_backup_content'];
  build_profile_backup_event?: WasmBridgeModule['build_profile_backup_event'];
  parse_profile_backup_event?: WasmBridgeModule['parse_profile_backup_event'];
  create_keyset_bundle?: WasmBridgeModule['create_keyset_bundle'];
};

type AssertedWasmBridgeModule = WasmBridgeModule & Required<WasmBridgeLoaderModule>;

declare global {
  interface Window {
    BifrostBridgeWasm?: WasmBridgeModule;
  }
}

let cachedModule: WasmBridgeModule | null = null;
let loadingModulePromise: Promise<WasmBridgeModule> | null = null;
let injectedModuleForTests: WasmBridgeModule | null = null;

function getAssetUrl(path: string) {
  return new URL(path, window.location.origin).toString();
}

function useBrowserAssetUrls() {
  return (
    typeof window !== 'undefined' &&
    !(typeof process !== 'undefined' && process.versions?.node)
  );
}

async function dynamicImportModule(url: string) {
  return await import(/* @vite-ignore */ url);
}

async function getLoaderImportUrl() {
  if (useBrowserAssetUrls()) {
    return getAssetUrl('wasm/bifrost_bridge_wasm.js');
  }
  throw new Error('No injected WASM bridge module is available in this non-browser environment.');
}

function getWasmBinaryUrl() {
  if (useBrowserAssetUrls()) {
    return getAssetUrl('wasm/bifrost_bridge_wasm_bg.wasm');
  }
  throw new Error('No browser WASM asset URL is available in this non-browser environment.');
}

async function getWasmBinaryInput() {
  return getWasmBinaryUrl();
}

function assertWasmBridgeModule(module: Partial<WasmBridgeModule>): AssertedWasmBridgeModule {
  if (
    !module.WasmBridgeRuntime ||
    !module.bf_package_version ||
    !module.bfshare_prefix ||
    !module.bfonboard_prefix ||
    !module.bfprofile_prefix ||
    !module.profile_backup_event_kind ||
    !module.profile_backup_key_domain ||
    !module.encode_bfshare_package ||
    !module.decode_bfshare_package ||
    !module.encode_bfonboard_package ||
    !module.decode_bfonboard_package ||
    !module.create_onboarding_request_bundle ||
    !module.build_onboarding_runtime_snapshot ||
    !module.derive_profile_id_from_share_secret ||
    !module.derive_profile_id_from_share_pubkey ||
    !module.encode_bfprofile_package ||
    !module.decode_bfprofile_package ||
    !module.create_profile_package_pair ||
    !module.create_encrypted_profile_backup ||
    !module.derive_profile_backup_conversation_key_hex ||
    !module.encrypt_profile_backup_content ||
    !module.decrypt_profile_backup_content ||
    !module.build_profile_backup_event ||
    !module.parse_profile_backup_event ||
    !module.create_keyset_bundle
  ) {
    throw new Error('WASM bridge module loaded but required exports are missing');
  }

  return module as AssertedWasmBridgeModule;
}

export function setInjectedWasmBridgeModuleForTests(module: WasmBridgeModule | null) {
  injectedModuleForTests = module;
  cachedModule = null;
  loadingModulePromise = null;
}

export async function loadWasmBridgeModule(): Promise<WasmBridgeModule> {
  if (cachedModule) return cachedModule;
  if (loadingModulePromise) return await loadingModulePromise;

  if (injectedModuleForTests) {
    cachedModule = assertWasmBridgeModule(injectedModuleForTests);
    return cachedModule;
  }

  const globalModule =
    typeof window !== 'undefined' ? window.BifrostBridgeWasm : undefined;
  if (globalModule?.WasmBridgeRuntime) {
    cachedModule = assertWasmBridgeModule(globalModule);
    return cachedModule;
  }

  const modulePath = '/wasm/bifrost_bridge_wasm.js';

  loadingModulePromise = (async () => {
    try {
      const imported = (await dynamicImportModule(
        await getLoaderImportUrl()
      )) as WasmBridgeLoaderModule;
      await imported.default({
        module_or_path: await getWasmBinaryInput()
      });

      const module = assertWasmBridgeModule(imported);

      cachedModule = module;
      if (typeof window !== 'undefined') {
        window.BifrostBridgeWasm = module;
      }
      return module;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown dynamic import error';
      throw new Error(
        `Failed to load ${modulePath}. Run "npm run build:bridge-wasm" first. (${message})`
      );
    } finally {
      loadingModulePromise = null;
    }
  })();

  return await loadingModulePromise;
}

export async function createWasmBridgeRuntime(): Promise<WasmBridgeRuntimeApi> {
  const module = await loadWasmBridgeModule();
  const raw = new module.WasmBridgeRuntime();
  return {
    init_runtime: raw.init_runtime.bind(raw),
    restore_runtime: raw.restore_runtime.bind(raw),
    handle_command: raw.handle_command.bind(raw),
    handle_inbound_event: raw.handle_inbound_event.bind(raw),
    tick: (nowUnixMs: number) => raw.tick(BigInt(nowUnixMs)),
    drain_outbound_events: raw.drain_outbound_events.bind(raw),
    drain_completions: raw.drain_completions.bind(raw),
    drain_failures: raw.drain_failures.bind(raw),
    snapshot_state: raw.snapshot_state.bind(raw),
    status: raw.status.bind(raw),
    peer_permission_states: raw.peer_permission_states.bind(raw),
    read_config: raw.read_config.bind(raw),
    update_config: raw.update_config.bind(raw),
    peer_status: raw.peer_status.bind(raw),
    readiness: raw.readiness.bind(raw),
    runtime_status: raw.runtime_status.bind(raw),
    runtime_diagnostics: raw.runtime_diagnostics.bind(raw),
    drain_runtime_events: raw.drain_runtime_events.bind(raw),
    wipe_state: raw.wipe_state.bind(raw),
    runtime_metadata: raw.runtime_metadata.bind(raw),
    set_policy_override: raw.set_policy_override.bind(raw),
    clear_policy_overrides: raw.clear_policy_overrides.bind(raw),
  };
}

export async function getWasmProfilePackageApi(): Promise<WasmProfilePackageApi> {
  const module = await loadWasmBridgeModule();
  return {
    bf_package_version: module.bf_package_version,
    bfshare_prefix: module.bfshare_prefix,
    bfonboard_prefix: module.bfonboard_prefix,
    bfprofile_prefix: module.bfprofile_prefix,
    profile_backup_event_kind: module.profile_backup_event_kind,
    profile_backup_key_domain: module.profile_backup_key_domain,
    encode_bfshare_package: module.encode_bfshare_package,
    decode_bfshare_package: module.decode_bfshare_package,
    encode_bfonboard_package: module.encode_bfonboard_package,
    decode_bfonboard_package: module.decode_bfonboard_package,
    create_onboarding_request_bundle: (
      shareSecret: string,
      peerPubkey32Hex: string,
      eventKind: number,
      sentAtSeconds?: number | null,
    ) =>
      module.create_onboarding_request_bundle(
        shareSecret,
        peerPubkey32Hex,
        BigInt(eventKind),
        sentAtSeconds,
      ),
    build_onboarding_runtime_snapshot: module.build_onboarding_runtime_snapshot,
    derive_profile_id_from_share_secret: module.derive_profile_id_from_share_secret,
    derive_profile_id_from_share_pubkey: module.derive_profile_id_from_share_pubkey,
    encode_bfprofile_package: module.encode_bfprofile_package,
    decode_bfprofile_package: module.decode_bfprofile_package,
    create_profile_package_pair: module.create_profile_package_pair,
    create_encrypted_profile_backup: module.create_encrypted_profile_backup,
    derive_profile_backup_conversation_key_hex:
      module.derive_profile_backup_conversation_key_hex,
    encrypt_profile_backup_content: module.encrypt_profile_backup_content,
    decrypt_profile_backup_content: module.decrypt_profile_backup_content,
    build_profile_backup_event: module.build_profile_backup_event,
    parse_profile_backup_event: module.parse_profile_backup_event
  };
}

export async function getWasmKeysetApi(): Promise<WasmKeysetApi> {
  const module = await loadWasmBridgeModule();
  return {
    create_keyset_bundle: module.create_keyset_bundle,
  };
}
