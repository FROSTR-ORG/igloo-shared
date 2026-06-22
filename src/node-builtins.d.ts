// Minimal ambient declarations for the node builtins used by the single
// node-only test (`profile-package.kat.test.ts`, which reads the WASM fixture
// off disk). igloo-shared is a browser-targeted package and deliberately avoids
// a `@types/node` dependency — pulling it in would reshape DOM timer typings
// (`setInterval`/`setTimeout`) across the whole package's typecheck.
declare module 'node:fs' {
  export function readFileSync(path: string | URL): Uint8Array;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
