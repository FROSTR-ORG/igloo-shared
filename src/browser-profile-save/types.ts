import type {
  BrowserFinalizedStoredProfile,
} from '../browser-profile-store';
import type { BrowserProfileSaveResult, BrowserRuntimeWarning } from '../browser-session-orchestration';

export type BrowserSaveActivateOptions<TRuntime> = {
  autoStart?: boolean;
  activate?: () => Promise<TRuntime>;
  runtimeUnavailableMessage?: string;
  onRuntimeUnavailable?: (warning: BrowserRuntimeWarning) => void | Promise<void>;
};

export type BrowserPersistFinalizedProfileArgs = {
  finalized: BrowserFinalizedStoredProfile;
  password: string;
};

export type BrowserPersistFinalizedProfile<TProfile> = (
  input: BrowserPersistFinalizedProfileArgs,
) => Promise<TProfile>;

export type BrowserSaveResult<TProfile, TRuntime> = BrowserProfileSaveResult<TProfile, TRuntime>;
