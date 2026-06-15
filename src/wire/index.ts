/**
 * Pure-type wire barrel.
 *
 * Re-exports every runtime/onboarding/bridge/policy/config wire shape from
 * the sibling modules. This barrel and all files it re-exports contain ONLY
 * `export type`/`export interface` declarations — zero runtime/value code —
 * so any consumer can `import type { ... } from 'igloo-shared/.../wire'`
 * without pulling in the browser runtime.
 *
 * NOTE: this is the *internal* wire surface. The package's public barrel
 * (`src/index.ts`) re-exports only the subset of these names that were
 * already part of the public API before PR29. Internal-only shapes
 * (`RuntimeConfig`, `OnboardingDecoded`, `BridgeEnvelope`, the snapshot /
 * bootstrap / group wire types, etc.) are reachable here for in-repo use but
 * are deliberately not re-exported from the public barrel.
 */

export type {
  DecodedOnboardingProfile,
  RuntimePeerStatus,
  RuntimeMetadata,
  RuntimeReadiness,
  RuntimeOperationReadiness,
  RuntimeReadinessExplanation,
  RuntimeStatusDetails,
  RuntimePendingOperation,
  RuntimePendingApproval,
  RuntimeOperationFailure,
  RuntimeLoadError,
  RuntimeOnboardingStatus,
  RuntimeStatusSummary,
  RuntimeEvent,
  GroupMemberWire,
  GroupPackageWire,
  RuntimeSnapshotWire,
  RuntimeBootstrapWire,
  ProfileBootstrapState,
} from './runtime';

export type {
  PolicyOverrideValue,
  RuntimeMethodPolicy,
  RuntimeMethodPolicyOverride,
  RuntimePeerPermissionState,
} from './policy';

export type {
  OnboardingDecoded,
  OnboardingRequestBundleWire,
  OnboardResponseWire,
  OnboardingRequestResult,
} from './onboarding';

export type { BridgeEnvelope } from './bridge';

export type { RuntimeConfig, RuntimeRestoreOptions } from './config';
