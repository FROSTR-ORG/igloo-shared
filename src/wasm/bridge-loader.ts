import { loadConfiguredWasmModule } from './loader-core';
import type {
  AssertedWasmBridgeModule,
  WasmBridgeLoaderConfig,
  WasmBridgeLoaderModule,
  WasmBridgeModule,
  WasmBridgeOnboardingApi,
  WasmBridgeRuntimeApi,
  WasmKeysetApi,
} from './types';

let cachedBridgeModule: WasmBridgeModule | null = null;
let loadingBridgeModulePromise: Promise<WasmBridgeModule> | null = null;
let injectedBridgeModuleForTests: WasmBridgeModule | null = null;
let configuredBridgeLoader: WasmBridgeLoaderConfig | null = null;

function assertWasmBridgeModule(module: Partial<WasmBridgeModule>): AssertedWasmBridgeModule {
  if (
    !module.WasmBridgeRuntime ||
    !module.create_onboarding_request_bundle ||
    !module.build_onboarding_runtime_snapshot ||
    !module.create_keyset_bundle ||
    !module.rotate_keyset_bundle ||
    !module.derive_group_id
  ) {
    throw new Error('WASM bridge module loaded but required exports are missing');
  }

  return module as AssertedWasmBridgeModule;
}

export function setInjectedWasmBridgeModuleForTests(module: WasmBridgeModule | null) {
  injectedBridgeModuleForTests = module;
  cachedBridgeModule = null;
  loadingBridgeModulePromise = null;
}

export function configureWasmBridgeLoader(config: WasmBridgeLoaderConfig) {
  configuredBridgeLoader = {
    loaderImportUrl: config.loaderImportUrl,
    wasmBinaryUrl: config.wasmBinaryUrl,
    preloadedModule: config.preloadedModule,
  };
  cachedBridgeModule = null;
  loadingBridgeModulePromise = null;
}

export function resetWasmBridgeLoaderConfig() {
  configuredBridgeLoader = null;
  cachedBridgeModule = null;
  loadingBridgeModulePromise = null;
}

export async function loadWasmBridgeModule(): Promise<WasmBridgeModule> {
  if (cachedBridgeModule) return cachedBridgeModule;
  if (loadingBridgeModulePromise) return await loadingBridgeModulePromise;

  if (injectedBridgeModuleForTests) {
    cachedBridgeModule = assertWasmBridgeModule(injectedBridgeModuleForTests);
    return cachedBridgeModule;
  }

  if (!configuredBridgeLoader) {
    throw new Error(
      'WASM bridge loader is not configured. Configure host asset URLs before calling shared WASM APIs.',
    );
  }

  loadingBridgeModulePromise = loadConfiguredWasmModule<WasmBridgeModule, WasmBridgeLoaderModule>(
    {
      config: configuredBridgeLoader,
      modulePath: '/wasm/bifrost_bridge_wasm.js',
      domain: 'runtime',
      missingSourceMessage: 'No bridge module source is configured',
      missingDefaultMessage: 'WASM bridge loader default export is missing',
      assertModule: assertWasmBridgeModule,
    },
  )
    .then((module) => {
      cachedBridgeModule = module;
      return module;
    })
    .finally(() => {
      loadingBridgeModulePromise = null;
    });

  return await loadingBridgeModulePromise;
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

export async function getWasmBridgeOnboardingApi(): Promise<WasmBridgeOnboardingApi> {
  const module = await loadWasmBridgeModule();
  return {
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
  };
}

export async function getWasmKeysetApi(): Promise<WasmKeysetApi> {
  const module = await loadWasmBridgeModule();
  return {
    create_keyset_bundle: module.create_keyset_bundle,
    rotate_keyset_bundle: module.rotate_keyset_bundle,
    derive_group_id: module.derive_group_id,
  };
}
