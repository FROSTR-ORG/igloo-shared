# igloo-shared

Shared TypeScript runtime and package-contract layer for the Igloo hosts.

`igloo-shared` provides the shared browser-facing runtime adapter, package handling, rotation helpers, and observability utilities consumed by the browser and desktop hosts.

## Status

- Beta.

## Owns

- shared browser/runtime host contracts
- package and backup helpers used by Igloo hosts
- rotation and adoption helpers used by browser and desktop hosts
- bridge-WASM integration boundary for the browser-facing stack

## Does Not Own

- app-specific UI and workflow composition
- desktop-native host logic
- extension-specific or PWA-specific shell behavior

## Build and Verify

```bash
npm install
npm run test:typecheck
npm run test:bridge-wasm-exports
```

Build bridge artifacts when needed:

```bash
npm run build:bridge-wasm
```

## Project Docs

- [TESTING.md](./TESTING.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
