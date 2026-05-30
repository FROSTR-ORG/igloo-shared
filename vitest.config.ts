import { defineConfig } from 'vitest/config';

import { createVitestBaseConfig } from './src/testing/vitest-base';

// igloo-shared runs in a node environment (no jsdom / no DOM setup); it shares
// the version-pinned base only for the toolchain conventions.
export default defineConfig({
  test: createVitestBaseConfig({ environment: 'node', setupFiles: [] }),
});
