# Contributing

This file explains the editing boundaries for `igloo-shared`.

## Ownership Rules

`igloo-shared` owns:

- shared signer/runtime core and host-neutral contracts
- shared package and backup helpers
- shared rotation/adoption helpers
- shared observability and runtime-state helper code

It does not own:

- app-specific product flows
- desktop-native integration
- extension-only background/offscreen behavior
- reusable presentational UI components

## Editing Guidance

- Keep host-neutral logic here.
- Do not move app-specific workflow policy into the shared layer without a deliberate cross-host decision.
- Update `README.md` and `TESTING.md` when public scripts or validation entrypoints change.
- When changing shared contracts, verify the consuming hosts remain aligned.
