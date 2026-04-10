# igloo-shared

Shared TypeScript runtime and package-contract layer for the Igloo hosts.

`igloo-shared` provides the shared signer core, package handling, rotation helpers, signer settings, bridge-WASM boundary, and observability utilities consumed by the browser hosts.

## Status

- Beta.

## Owns

- shared signer/runtime core and host-neutral contracts
- package and backup helpers used by Igloo hosts
- rotation and adoption helpers used by browser and desktop hosts
- bridge-WASM integration boundary for the browser-facing stack

## Does Not Own

- app-specific UI and workflow composition
- host lifecycle adapters for Chrome or the web app
- desktop-native host logic
- extension-specific or PWA-specific shell behavior

## Build and Verify

```bash
npm install
npm run test:typecheck
npm run test:browser-wasm-exports
```

Build bridge artifacts when needed:

```bash
npm run build:browser-wasm
```

## Project Docs

- [TESTING.md](./TESTING.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
