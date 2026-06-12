import { loadConfiguredWasmModule } from './loader-core';
import type {
  AssertedWasmProfileModule,
  WasmProfileLoaderConfig,
  WasmProfileLoaderModule,
  WasmProfileModule,
  WasmProfilePackageApi,
} from './types';

let cachedProfileModule: WasmProfileModule | null = null;
let loadingProfileModulePromise: Promise<WasmProfileModule> | null = null;
let injectedProfileModuleForTests: WasmProfileModule | null = null;
let configuredProfileLoader: WasmProfileLoaderConfig | null = null;

function hasProfileExports(module: Partial<WasmProfileModule>): module is WasmProfileModule {
  return !!(
    module.bf_package_version &&
    module.bfshare_prefix &&
    module.bfonboard_prefix &&
    module.bfprofile_prefix &&
    module.encode_bfshare_package &&
    module.decode_bfshare_package &&
    module.encode_bfonboard_package &&
    module.decode_bfonboard_package &&
    module.derive_profile_id_from_share_secret &&
    module.derive_profile_id_from_share_pubkey &&
    module.encode_bfprofile_package &&
    module.decode_bfprofile_package &&
    module.create_profile_package_pair
  );
}

function assertWasmProfileModule(module: Partial<WasmProfileModule>): AssertedWasmProfileModule {
  if (!hasProfileExports(module)) {
    throw new Error('WASM profile module loaded but required exports are missing');
  }

  return module as AssertedWasmProfileModule;
}

export function setInjectedWasmProfileModuleForTests(module: WasmProfileModule | null) {
  injectedProfileModuleForTests = module;
  cachedProfileModule = null;
  loadingProfileModulePromise = null;
}

export function configureWasmProfileLoader(config: WasmProfileLoaderConfig) {
  configuredProfileLoader = {
    loaderImportUrl: config.loaderImportUrl,
    wasmBinaryUrl: config.wasmBinaryUrl,
    preloadedModule: config.preloadedModule,
  };
  cachedProfileModule = null;
  loadingProfileModulePromise = null;
}

export function resetWasmProfileLoaderConfig() {
  configuredProfileLoader = null;
  cachedProfileModule = null;
  loadingProfileModulePromise = null;
}

export async function loadWasmProfileModule(): Promise<WasmProfileModule> {
  if (cachedProfileModule) return cachedProfileModule;
  if (loadingProfileModulePromise) return await loadingProfileModulePromise;

  if (injectedProfileModuleForTests) {
    cachedProfileModule = assertWasmProfileModule(injectedProfileModuleForTests);
    return cachedProfileModule;
  }

  if (!configuredProfileLoader) {
    throw new Error(
      'WASM profile loader is not configured. Configure host asset URLs before calling shared WASM profile APIs.',
    );
  }

  loadingProfileModulePromise =
    loadConfiguredWasmModule<WasmProfileModule, WasmProfileLoaderModule>({
      config: configuredProfileLoader,
      modulePath: '/wasm/bifrost_profile_wasm.js',
      domain: 'profile',
      missingSourceMessage: 'No profile module source is configured',
      missingDefaultMessage: 'WASM profile loader default export is missing',
      assertModule: assertWasmProfileModule,
    })
      .then((module) => {
        cachedProfileModule = module;
        return module;
      })
      .finally(() => {
        loadingProfileModulePromise = null;
      });

  return await loadingProfileModulePromise;
}

export async function getWasmProfilePackageApi(): Promise<WasmProfilePackageApi> {
  const module = await loadWasmProfileModule();
  return {
    bf_package_version: module.bf_package_version,
    bfshare_prefix: module.bfshare_prefix,
    bfonboard_prefix: module.bfonboard_prefix,
    bfprofile_prefix: module.bfprofile_prefix,
    encode_bfshare_package: module.encode_bfshare_package,
    decode_bfshare_package: module.decode_bfshare_package,
    encode_bfonboard_package: module.encode_bfonboard_package,
    decode_bfonboard_package: module.decode_bfonboard_package,
    derive_profile_id_from_share_secret: module.derive_profile_id_from_share_secret,
    derive_profile_id_from_share_pubkey: module.derive_profile_id_from_share_pubkey,
    encode_bfprofile_package: module.encode_bfprofile_package,
    decode_bfprofile_package: module.decode_bfprofile_package,
    create_profile_package_pair: module.create_profile_package_pair,
  };
}
