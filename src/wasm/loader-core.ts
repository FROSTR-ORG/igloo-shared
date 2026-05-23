import type { WasmLoaderConfig, WasmLoaderInitModule } from './types';

export const BROWSER_WASM_BUILD_COMMAND = 'make browser-wasm-refresh';

export async function dynamicImportModule(url: string) {
  return await import(/* @vite-ignore */ url);
}

export async function loadConfiguredWasmModule<
  TModule,
  TLoaderModule extends WasmLoaderInitModule,
>(
  input: {
    config: WasmLoaderConfig<TModule, TLoaderModule>;
    modulePath: string;
    domain: 'runtime' | 'profile';
    missingSourceMessage: string;
    missingDefaultMessage: string;
    assertModule: (module: Partial<TModule>) => TModule;
  },
): Promise<TModule> {
  try {
    console.warn(
      JSON.stringify({
        ts: Date.now(),
        level: 'warn',
        component: 'igloo.wasm-loader',
        domain: input.domain,
        event: 'load_module_begin',
        has_preloaded_module: !!input.config.preloadedModule,
        loader_import_url: input.config.loaderImportUrl ?? null,
      }),
    );

    const imported = (input.config.preloadedModule ??
      (input.config.loaderImportUrl
        ? ((await dynamicImportModule(input.config.loaderImportUrl)) as TLoaderModule)
        : null)) as (Partial<TModule> & Partial<TLoaderModule>) | null;

    if (!imported) {
      throw new Error(input.missingSourceMessage);
    }
    if (typeof imported.default !== 'function') {
      throw new Error(input.missingDefaultMessage);
    }

    await imported.default({
      module_or_path: input.config.wasmBinaryUrl,
    });

    return input.assertModule(imported);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown dynamic import error';
    throw new Error(
      `Failed to load ${input.modulePath}. Run "${BROWSER_WASM_BUILD_COMMAND}" first. (${message})`,
    );
  }
}
