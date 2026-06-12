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

export type WasmBridgeOnboardingApi = {
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
};

export type WasmProfilePackageApi = {
  bf_package_version: () => number;
  bfshare_prefix: () => string;
  bfonboard_prefix: () => string;
  bfprofile_prefix: () => string;
  encode_bfshare_package: (payloadJson: string, password: string) => string;
  decode_bfshare_package: (packageText: string, password: string) => string;
  encode_bfonboard_package: (payloadJson: string, password: string) => string;
  decode_bfonboard_package: (packageText: string, password: string) => string;
  derive_profile_id_from_share_secret: (shareSecret: string) => string;
  derive_profile_id_from_share_pubkey: (sharePubkey: string) => string;
  encode_bfprofile_package: (payloadJson: string, password: string) => string;
  decode_bfprofile_package: (packageText: string, password: string) => string;
  create_profile_package_pair: (payloadJson: string, password: string) => string;
};

export type WasmKeysetApi = {
  create_keyset_bundle: (configJson: string) => string;
  rotate_keyset_bundle: (inputJson: string) => string;
  recover_secret_key_from_shares: (inputJson: string) => string;
  derive_group_id: (groupJson: string) => string;
};

export type WasmLoaderInitModule = {
  default: (options?: {
    module_or_path?: string | URL | ArrayBuffer | ArrayBufferView;
  }) => Promise<unknown>;
};

export type WasmBridgeModule = {
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
  create_onboarding_request_bundle: (
    shareSecret: string,
    peerPubkey32Hex: string,
    eventKind: bigint,
    sentAtSeconds?: number | null,
  ) => string;
  build_onboarding_runtime_snapshot: WasmBridgeOnboardingApi['build_onboarding_runtime_snapshot'];
  create_keyset_bundle: WasmKeysetApi['create_keyset_bundle'];
  rotate_keyset_bundle: WasmKeysetApi['rotate_keyset_bundle'];
  recover_secret_key_from_shares: WasmKeysetApi['recover_secret_key_from_shares'];
  derive_group_id: WasmKeysetApi['derive_group_id'];
};

export type WasmBridgeLoaderModule = WasmLoaderInitModule & {
  WasmBridgeRuntime?: WasmBridgeModule['WasmBridgeRuntime'];
  create_onboarding_request_bundle?: WasmBridgeModule['create_onboarding_request_bundle'];
  build_onboarding_runtime_snapshot?: WasmBridgeModule['build_onboarding_runtime_snapshot'];
  create_keyset_bundle?: WasmBridgeModule['create_keyset_bundle'];
  rotate_keyset_bundle?: WasmBridgeModule['rotate_keyset_bundle'];
  recover_secret_key_from_shares?: WasmBridgeModule['recover_secret_key_from_shares'];
  derive_group_id?: WasmBridgeModule['derive_group_id'];
};

export type WasmProfileModule = {
  bf_package_version: WasmProfilePackageApi['bf_package_version'];
  bfshare_prefix: WasmProfilePackageApi['bfshare_prefix'];
  bfonboard_prefix: WasmProfilePackageApi['bfonboard_prefix'];
  bfprofile_prefix: WasmProfilePackageApi['bfprofile_prefix'];
  encode_bfshare_package: WasmProfilePackageApi['encode_bfshare_package'];
  decode_bfshare_package: WasmProfilePackageApi['decode_bfshare_package'];
  encode_bfonboard_package: WasmProfilePackageApi['encode_bfonboard_package'];
  decode_bfonboard_package: WasmProfilePackageApi['decode_bfonboard_package'];
  derive_profile_id_from_share_secret: WasmProfilePackageApi['derive_profile_id_from_share_secret'];
  derive_profile_id_from_share_pubkey: WasmProfilePackageApi['derive_profile_id_from_share_pubkey'];
  encode_bfprofile_package: WasmProfilePackageApi['encode_bfprofile_package'];
  decode_bfprofile_package: WasmProfilePackageApi['decode_bfprofile_package'];
  create_profile_package_pair: WasmProfilePackageApi['create_profile_package_pair'];
};

export type WasmProfileLoaderModule = WasmLoaderInitModule & {
  bf_package_version?: WasmProfileModule['bf_package_version'];
  bfshare_prefix?: WasmProfileModule['bfshare_prefix'];
  bfonboard_prefix?: WasmProfileModule['bfonboard_prefix'];
  bfprofile_prefix?: WasmProfileModule['bfprofile_prefix'];
  encode_bfshare_package?: WasmProfileModule['encode_bfshare_package'];
  decode_bfshare_package?: WasmProfileModule['decode_bfshare_package'];
  encode_bfonboard_package?: WasmProfileModule['encode_bfonboard_package'];
  decode_bfonboard_package?: WasmProfileModule['decode_bfonboard_package'];
  derive_profile_id_from_share_secret?: WasmProfileModule['derive_profile_id_from_share_secret'];
  derive_profile_id_from_share_pubkey?: WasmProfileModule['derive_profile_id_from_share_pubkey'];
  encode_bfprofile_package?: WasmProfileModule['encode_bfprofile_package'];
  decode_bfprofile_package?: WasmProfileModule['decode_bfprofile_package'];
  create_profile_package_pair?: WasmProfileModule['create_profile_package_pair'];
};

export type AssertedWasmBridgeModule = WasmBridgeModule & Required<WasmBridgeLoaderModule>;
export type AssertedWasmProfileModule = WasmProfileModule & Required<WasmProfileLoaderModule>;

export type WasmLoaderConfig<TModule, TLoaderModule extends WasmLoaderInitModule> = {
  loaderImportUrl?: string;
  wasmBinaryUrl: string;
  preloadedModule?: Partial<TModule> & Partial<TLoaderModule>;
};

export type WasmBridgeLoaderConfig = WasmLoaderConfig<WasmBridgeModule, WasmBridgeLoaderModule>;
export type WasmProfileLoaderConfig = WasmLoaderConfig<WasmProfileModule, WasmProfileLoaderModule>;
