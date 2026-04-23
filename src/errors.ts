/**
 * Typed error classes for the browser runtime.
 *
 * These replace `throw new Error(\`${reason}: ${JSON.stringify(obj)}\`)` patterns
 * where an open-ended structured object would otherwise be embedded in the
 * human-readable error message.
 *
 * Motivation: if a future bifrost-rs change adds secret-bearing fields to a
 * readiness blob or similar structured response, the inline `JSON.stringify`
 * throw would surface those fields in every thrown error (including logs,
 * analytics, and any caller that serialises the `.message` string). Typed
 * errors with named scalar fields make the contract explicit: only fields
 * that are explicitly surfaced can leak.
 *
 * Every typed error here follows the same pattern:
 *
 *   - `message` is a stable, machine-readable identifier (e.g.
 *     `'sign_readiness_timeout'`), never a stringified object.
 *   - `name` is set to the class name for `instanceof` + `err.name` flows.
 *   - Named fields are plain scalars / arrays of scalars, never nested
 *     structured objects.
 *
 * Callers can switch on `instanceof RuntimeReadinessTimeoutError` (or check
 * `err.name`) and read the named fields directly.
 */

/** The category of operation whose readiness check timed out. */
export type RuntimeReadinessOperation = 'sign' | 'ecdh';

/**
 * Thrown by `prepareOperation` when the runtime does not reach the
 * readiness state required for the requested operation within the
 * prepare-operation timeout window.
 *
 * The message is a stable string (`sign_readiness_timeout` or
 * `ecdh_readiness_timeout`). Structured context is surfaced via the named
 * scalar fields on this class. No open-ended object is ever embedded in
 * `message`.
 */
export class RuntimeReadinessTimeoutError extends Error {
  public readonly name = 'RuntimeReadinessTimeoutError';
  public readonly reason: RuntimeReadinessOperation;
  public readonly threshold: number;
  public readonly signingPeerCount: number;
  public readonly ecdhPeerCount: number;
  public readonly degradedReasonCount: number;

  constructor(
    reason: RuntimeReadinessOperation,
    threshold: number,
    signingPeerCount: number,
    ecdhPeerCount: number,
    degradedReasonCount: number,
  ) {
    super(`${reason}_readiness_timeout`);
    this.reason = reason;
    this.threshold = threshold;
    this.signingPeerCount = signingPeerCount;
    this.ecdhPeerCount = ecdhPeerCount;
    this.degradedReasonCount = degradedReasonCount;
    Object.setPrototypeOf(this, RuntimeReadinessTimeoutError.prototype);
  }
}
