/**
 * Pure policy wire-shape type declarations.
 *
 * Per-peer permission state and method-policy projections exchanged with the
 * bifrost-rs WASM runtime. Pure types only — no runtime/value code.
 *
 * Extracted from `browser-runtime-core.ts` (PR29, Bucket G.1). No behavior
 * changed; only the declarations moved.
 */

export type PolicyOverrideValue = 'unset' | 'allow' | 'deny' | 'ask';

export type RuntimeMethodPolicy = {
  ping: boolean;
  onboard: boolean;
  sign: boolean;
  ecdh: boolean;
};

export type RuntimeMethodPolicyOverride = {
  ping: PolicyOverrideValue;
  onboard: PolicyOverrideValue;
  sign: PolicyOverrideValue;
  ecdh: PolicyOverrideValue;
};

export type RuntimePeerPermissionState = {
  pubkey: string;
  manual_override: {
    request: RuntimeMethodPolicyOverride;
    respond: RuntimeMethodPolicyOverride;
  };
  remote_observation: {
    request: RuntimeMethodPolicy;
    respond: RuntimeMethodPolicy;
    updated: number;
    revision: number;
  } | null;
  effective_policy: {
    request: RuntimeMethodPolicy;
    respond: RuntimeMethodPolicy;
  };
};
