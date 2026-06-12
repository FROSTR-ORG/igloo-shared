// Public package barrel.
//
// PR29 (Bucket G.6): the previous 19 `export *` lines were replaced with
// explicit named re-exports. The set of names below reproduces the exact
// public surface that was reachable via `import { X } from 'igloo-shared'`
// before the change — no symbol was added or removed. Wire-shape TYPES now
// originate from `./wire`; everything else re-exports from the same module
// as before.
//
// When adding or removing a public export, update the matching list here.
// Internal-only wire shapes (e.g. RuntimeConfig, OnboardingDecoded,
// BridgeEnvelope, the snapshot/bootstrap/group wire types) are intentionally
// NOT re-exported here; they remain reachable in-repo via `./wire`.

// --- Wire-shape types (extracted from browser-runtime-core in PR29) ---
export type {
  DecodedOnboardingProfile,
  RuntimeEvent,
  RuntimeMetadata,
  RuntimeOnboardingStatus,
  RuntimeOperationReadiness,
  RuntimePeerStatus,
  RuntimePendingOperation,
  RuntimeReadiness,
  RuntimeReadinessExplanation,
  RuntimeStatusDetails,
  RuntimeStatusSummary,
} from './wire';
export type {
  PolicyOverrideValue,
  RuntimeMethodPolicy,
  RuntimeMethodPolicyOverride,
  RuntimePeerPermissionState,
} from './wire';

// --- bridge-wasm-runtime ---
export {
  configureWasmBridgeLoader,
  configureWasmProfileLoader,
  createWasmBridgeRuntime,
  getWasmBridgeOnboardingApi,
  getWasmKeysetApi,
  getWasmProfilePackageApi,
  loadWasmBridgeModule,
  loadWasmProfileModule,
  resetWasmBridgeLoaderConfig,
  resetWasmProfileLoaderConfig,
  setInjectedWasmBridgeModuleForTests,
  setInjectedWasmProfileModuleForTests,
} from './bridge-wasm-runtime';
export type {
  WasmBridgeLoaderConfig,
  WasmBridgeOnboardingApi,
  WasmBridgeRuntimeApi,
  WasmKeysetApi,
  WasmProfileLoaderConfig,
  WasmProfilePackageApi,
} from './bridge-wasm-runtime';

// --- errors ---
export { RuntimeReadinessTimeoutError } from './errors';
export type { RuntimeReadinessOperation } from './errors';

// --- secret ---
export { Secret, SecretBytes } from './secret';
export type { Passphrase, ShareSecretHex } from './secret';

// --- observability-schema ---
export { EVENT_SCHEMAS, hasEventSchema, sanitizeDetails } from './observability-schema';
export type { EventSchema } from './observability-schema';

// --- browser-onboarding ---
export {
  createBrowserOnboardingConnection,
  createConnectedBrowserProfilePayload,
  finalizeConnectedBrowserProfile,
  finalizeRotatedBrowserProfile,
  prepareBrowserRotationProfilePayload,
} from './browser-onboarding';
export type {
  BrowserConnectedProfileFinalizeArgs,
  BrowserConnectedProfileFinalizeResult,
  BrowserConnectedProfileInput,
  BrowserOnboardingConnection,
  BrowserRotationProfileFinalizeArgs,
  BrowserRotationProfileTarget,
} from './browser-onboarding';

// --- browser-profile ---
export {
  createBrowserProfileArtifactRefs,
  createBrowserProfilePreview,
  createBrowserRuntimeProfileSummary,
  createDefaultManualPeerPolicy,
  groupJsonFromPayload,
  normalizeGroupMemberSharePublicKey,
  normalizeHex32,
  profilePayloadFromRuntimeSnapshot,
  publicKeyFromSecret,
  shareJsonFromPayload,
} from './browser-profile/core';
export type {
  BrowserProfileArtifactRefs,
  BrowserProfilePreview,
  BrowserProfileSource,
  BrowserRuntimeProfileSummary,
} from './browser-profile/core';

// --- browser-profile-persistence ---
export {
  assertBrowserProfileIdAvailable,
  createBrowserPersistedProfileBundle,
  duplicateBrowserProfileMessage,
} from './browser-profile/persistence';
export type {
  BrowserDuplicateProfileInput,
  BrowserPersistedProfileBundle,
} from './browser-profile/persistence';

// --- browser-profile-recovery ---
export {
  importAndSaveBrowserProfilePackage,
  importBrowserProfilePackage,
} from './browser-profile/recovery';
export type {
  BrowserImportedProfilePackage,
} from './browser-profile/recovery';

// --- browser-profile-save ---
export {
  logSharedSaveFailure,
  saveBrowserProfileAndMaybeActivate,
  saveConnectedBrowserProfileAndMaybeActivate,
  saveFinalizedBrowserProfileAndMaybeActivate,
  saveImportedBrowserProfileAndMaybeActivate,
  saveRotatedBrowserProfileAndMaybeActivate,
} from './browser-profile/save';
export type {
  BrowserPersistFinalizedProfile,
  BrowserPersistFinalizedProfileArgs,
  BrowserSaveActivateOptions,
  BrowserSaveResult,
} from './browser-profile/save';

// --- browser-profile-store ---
export {
  createBrowserRuntimeProfileProjection,
  createBrowserStoredProfilePayloadSource,
  createBrowserStoredProfileProjection,
  createBrowserStoredRuntimeProfile,
  createFinalizedBrowserStoredProfile,
  normalizeBrowserStoredProfilePayload,
  reconstructBrowserProfilePackagePayload,
} from './browser-profile/store';
export type {
  BrowserFinalizedStoredProfile,
  BrowserRuntimeProfileProjection,
  BrowserStoredProfilePayloadInput,
  BrowserStoredProfilePayloadSource,
  BrowserStoredProfileProjection,
  BrowserStoredRuntimeProfile,
  NormalizedBrowserStoredProfilePayload,
} from './browser-profile/store';

// --- runtime-api (split out of browser-runtime-core in PR30) ---
export {
  BrowserBridgeNode,
  DEFAULT_RELAYS,
  MAX_ONBOARDING_DECRYPTS,
  clearRuntimePeerPolicyOverridesOnNode,
  connectSignerNode,
  createOnboardingDecryptCounter,
  createPendingBridgeCommandState,
  createSignerNode,
  decodeOnboardingProfile,
  deriveReadinessExplanation,
  detachEvent,
  getPublicKeyFromNode,
  getRuntimeConfigFromNode,
  getRuntimeMetadata,
  getRuntimePeerPermissionStatesFromNode,
  getRuntimePeerStatus,
  getRuntimeReadiness,
  getRuntimeSnapshot,
  getRuntimeStatus,
  getSharePublicKeyFromNode,
  matchBridgeCompletion,
  nip44DecryptWithNode,
  nip44EncryptWithNode,
  normalizeRelays,
  pingSinglePeer,
  prepareEcdhOnNode,
  prepareSignOnNode,
  recordOnboardingDecryptAttempt,
  refreshAllPeersOnNode,
  refreshPeerStatuses,
  signNostrEvent,
  startSignerNode,
  stopSignerNode,
  updateRuntimeConfigOnNode,
  updateRuntimePeerPolicyOverrideOnNode,
  validateOnboardCredential,
  validateOnboardingGroup,
  validateOnboardingPassword,
  wipeRuntimeStateOnNode,
} from './runtime-api';
export type {
  BridgeDispatchOutcome,
  OnboardingDecryptCounter,
  OnboardingGroupValidation,
  PeerPolicy,
  PendingBridgeCommand,
  PendingBridgeCommandKind,
  PendingBridgeCommandState,
  PingResult,
  ValidationResult,
} from './runtime-api';

// --- runtime projections (PR32, Bucket G.4) ---
export {
  countKnownPeers,
  countOnlinePeers,
  hasPendingSigns,
  selectActivePeers,
  selectNoncePoolCapacity,
  selectOnboardingStatuses,
  selectPeerPermissionStates,
  selectPendingOperations,
  selectReadinessExplanation,
} from './runtime-projections';

// --- browser-profile/session-orchestration ---
// `completeBrowserProfileSave`, `createRuntimeUnavailableWarning`,
// `BrowserProfileSaveResult`, and `BrowserRuntimeWarning` are exported once
// below via `browser-profile/runtime-session` (which re-exports the same
// symbols); re-listing them here would be a duplicate export, so they are
// omitted.

// --- browser-profile/runtime-session ---
export {
  completeBrowserProfileSave,
  createBrowserRuntimeNodeInit,
  createRuntimeUnavailableWarning,
  runtimePayloadFromSnapshot,
} from './browser-profile/runtime-session';
export type {
  BrowserProfileRuntimeBootstrapInput,
  BrowserProfileSaveResult,
  BrowserRuntimeBootstrapProfile,
  BrowserRuntimeNodeInit,
  BrowserRuntimeProfilePayload,
  BrowserRuntimeStoredProfile,
  BrowserRuntimeWarning,
} from './browser-profile/runtime-session';

// --- nip44-normalize ---
export {
  MAX_NIP44_PAYLOAD_LEN,
  Nip44NormalizeError,
  normalizeNip44PayloadForJs,
  normalizeNip44PayloadForRust,
} from './nip44-normalize';
export type { Nip44NormalizeReason } from './nip44-normalize';

// --- observability ---
export {
  createLogger,
  createObservabilityBuffer,
  createObservabilityEvent,
  summarizeRuntimeLifecycle,
} from './observability';
export type { ObservabilityEvent, ObservabilityLevel } from './observability';

// --- profile-package ---
export {
  buildProfileDownloadFilename,
  createProfilePackagePair,
  decodeBfOnboardPackage,
  decodeBfProfilePackage,
  decodeBfSharePackage,
  deriveProfileIdFromSharePublicKey,
  deriveProfileIdFromShareSecret,
  encodeBfOnboardPackage,
  encodeBfProfilePackage,
  encodeBfSharePackage,
  groupNameFromPackage,
  groupPackageFromWireJson,
  groupPackageToWireJson,
  groupPackageToWireValue,
  groupPublicKeyFromPackage,
  sharePackageToWireJson,
  sharePackageToWireValue,
  shortProfileId,
  totalCountFromGroupPackage,
  xOnlyFromCompressedPubkey,
} from './profile-package';
export type {
  BrowserGroupPackage,
  BrowserGroupPackageMember,
  BrowserManualPeerPolicyOverride,
  BrowserMethodPolicyOverride,
  BrowserOnboardPackagePayload,
  BrowserPeerPolicyOverride,
  BrowserPolicyOverrideValue,
  BrowserProfilePackagePayload,
  BrowserProtectedPackageKind,
  BrowserSharePackagePayload,
} from './profile-package';

// --- relay-ping ---
export { pingRelay } from './relay-ping';
export type { RelayPingResult } from './relay-ping';

// --- rotation ---
export {
  buildRotationDistributionArtifact,
  buildRotationDraft,
  buildRotationProfilePayload,
  recoverSecretKeyFromShares,
} from './rotation';
export type {
  BrowserRecoveredKey,
  BrowserRotationDraft,
  RotationDistributionArtifact,
  RotationTargetAssignment,
} from './rotation';

// --- signer-settings ---
export { DEFAULT_SIGNER_SETTINGS, normalizeSignerSettings } from './signer-settings';
export type { PeerSelectionStrategy, SignerSettings } from './signer-settings';
