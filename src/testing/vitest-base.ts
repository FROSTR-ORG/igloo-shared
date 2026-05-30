// Shared base for the FROSTR repos' vitest configs: one toolchain (vitest 4 +
// jsdom 28), globals on, a sensible default timeout. Repos pass `setupFiles`
// and `include`, and node-only repos (igloo-shared itself) override
// `environment: 'node'`.
//
// The shape is intentionally permissive (a structural type with an index
// signature) so this module needs no `vitest` type import and stays decoupled
// from vitest's own config typings across versions. Consumers feed the result
// to their own `defineConfig({ test: createVitestBaseConfig({ ... }) })`.
//
// Canonical source; COPIED into igloo-ui and kept in lockstep by
// scripts/check-shared-test-setup.sh.

export interface VitestBaseOptions {
  environment?: 'jsdom' | 'node' | 'happy-dom' | 'edge-runtime';
  globals?: boolean;
  setupFiles?: string[];
  testTimeout?: number;
  include?: string[];
  [key: string]: unknown;
}

export function createVitestBaseConfig(overrides: VitestBaseOptions = {}): VitestBaseOptions {
  return {
    environment: 'jsdom',
    globals: true,
    testTimeout: 30_000,
    ...overrides,
  };
}
