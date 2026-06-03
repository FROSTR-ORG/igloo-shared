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

## Runtime Integration

Hosts drive the signer through the free functions in `runtime-api.ts`, which
operate on a `BrowserBridgeNode`. The canonical lifecycle is:

```text
configureWasmBridgeLoader({ loaderImportUrl, wasmBinaryUrl })   // once, at boot
  → createSignerNode(config, restoreOptions?) : BrowserBridgeNode
    → connectSignerNode(node)            // or startSignerNode(config) to do both
      → getRuntimeStatus(node) / getRuntimeReadiness(node)   // hosted read model
      → prepareSignOnNode(node) → signNostrEvent(node, event)
      → prepareEcdhOnNode(node) → nip44EncryptWithNode(node, pubkey, text)
      → pingSinglePeer(node, pubkey)
  → stopSignerNode(node)                 // tears the node down
```

`createSignerNode` does not touch WASM — it only constructs the node; all WASM
and relay work happens inside `connectSignerNode`/`node.connect()`. Configure
the loader (and `configureWasmProfileLoader` for package operations) before the
first call into any shared WASM API, or loading throws "WASM bridge loader is
not configured".

The signer is the source of truth for readiness: read it from
`getRuntimeStatus(node)` (the canonical hosted read model) rather than inferring
it from `getRuntimeSnapshot(node)` (persistence/diagnostics only). Use
`prepareSignOnNode` / `prepareEcdhOnNode` to gate an operation on readiness
instead of guessing from a snapshot.

### Runtime config modes

`RuntimeConfig.mode` selects how the node bootstraps:

- `onboarding` — decode a `bfonboard` package (`onboardPackage` /
  `onboardPassword`) and join an existing group.
- `profile` — bootstrap from an imported `bfprofile` device profile
  (`groupPackageJson` / `sharePackageJson`, optional bootstrap peer).
- `persisted` — restore a previously saved runtime snapshot
  (`restoreOptions.runtimeSnapshotJson`).

### Package flows

Package encode/decode and recovery use the profile-package and rotation
helpers (canonical crypto lives in the `frostr-utils` crate; the envelope and
package formats are specified in the shared-system `CRYPTOGRAPHY.md` and
`BACKUP.md` manuals):

- **Onboarding** — `decodeOnboardingProfile(bfonboard, password)` →
  `createSignerNode({ mode: 'onboarding', ... })`.
- **Profile import** — `decodeBfProfilePackage(bfprofile, password)` →
  `createSignerNode({ mode: 'profile', ... })`.
- **Recovery** — `recoverProfileFromSharePackage(...)` reconstructs a profile
  from a `bfshare` plus the relay backup.
- **Rotation** — the `rotation` helpers reconstruct the signing key from a
  threshold of `bfshare` inputs and split fresh shares (same group key).
- **Signing** — once connected, `prepareSignOnNode` then `signNostrEvent`.

The operator-facing runtime functions (`runtime-api.ts`) carry JSDoc describing
their parameters, thrown errors, and required caller order; the `wire/` module
documents the canonical runtime / onboarding / policy shapes and their
bifrost-rs source of truth.

## Project Docs

- [TESTING.md](./TESTING.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
