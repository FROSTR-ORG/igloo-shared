# Testing

`igloo-shared` owns the shared TypeScript contract layer used by multiple Igloo hosts.

## Fast Baseline

```bash
npm run test:typecheck
npm run test:browser-wasm-exports
```

These checks are the main guardrails for:

- TypeScript public-surface consistency
- bridge-WASM export alignment
- shared host/package contract stability

## Downstream Validation

Behavior changes in `igloo-shared` should also be validated through the consuming hosts:

- `igloo-pwa`
- `igloo-chrome`
- `igloo-home`

Use the workspace browser/desktop E2E suites when a shared contract change affects runtime, package, onboarding, recovery, or rotation behavior.
