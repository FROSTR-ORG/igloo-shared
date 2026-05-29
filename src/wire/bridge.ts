/**
 * Pure bridge envelope wire-shape type declarations.
 *
 * Describes the encrypted bridge envelope that wraps a typed payload sent
 * over the relay during onboarding and signing flows. Pure types only — no
 * runtime/value code.
 *
 * Extracted from `browser-runtime-core.ts` (PR29, Bucket G.1). No behavior
 * changed; only the declaration moved.
 */

export type BridgeEnvelope = {
  request_id: string;
  sent_at: number;
  payload: {
    type: string;
    data: unknown;
  };
};
