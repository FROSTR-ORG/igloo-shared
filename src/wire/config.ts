/**
 * Pure runtime-configuration wire-shape type declarations.
 *
 * Configuration and restore-option shapes accepted by the browser signer
 * runtime constructor. Pure types only — no runtime/value code. The
 * `SignerSettings` reference is a type-only import.
 *
 * Extracted from `browser-runtime-core.ts` (PR29, Bucket G.1). No behavior
 * changed; only the declarations moved.
 */

import type { SignerSettings } from '../signer-settings';

export type RuntimeConfig = {
  mode: 'onboarding' | 'persisted' | 'profile';
  relays: string[];
  signerSettings?: Partial<SignerSettings>;
  onboardPackage?: string;
  onboardPassword?: string;
  bootstrapPeerPubkey32Hex?: string;
  runtimeSnapshotJson?: string | null;
  groupPackageJson?: string;
  sharePackageJson?: string;
};

export type RuntimeRestoreOptions = {
  runtimeSnapshotJson?: string | null;
};
