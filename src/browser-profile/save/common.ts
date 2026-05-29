import { createLogger } from '../../observability';
import {
  completeBrowserProfileSave,
  type BrowserProfileSaveResult,
} from '../session-orchestration';
import type { BrowserFinalizedStoredProfile } from '../store';
import type {
  BrowserPersistFinalizedProfile,
  BrowserSaveActivateOptions,
} from './types';

const logger = createLogger('browser.profile-save');

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : typeof error === 'string' && error.trim()
      ? error
      : fallback;
}

export async function saveBrowserProfileAndMaybeActivate<TProfile, TRuntime>(args: {
  profile: TProfile;
} & BrowserSaveActivateOptions<TRuntime>): Promise<BrowserProfileSaveResult<TProfile, TRuntime>> {
  try {
    const saved = await completeBrowserProfileSave(args);
    if (saved.runtimeWarning) {
      logger.warn('profile', 'activate_runtime_unavailable', {
        stage: 'activate',
        warning_code: saved.runtimeWarning.code,
        warning_message: saved.runtimeWarning.message,
        warning_detail: saved.runtimeWarning.detail,
      });
    }
    return saved;
  } catch (error) {
    logger.error('profile', 'activate_failed', {
      stage: 'activate',
      error_message: toErrorMessage(error, 'failed to complete browser profile save'),
    });
    throw error;
  }
}

export async function saveFinalizedBrowserProfileAndMaybeActivate<TProfile, TRuntime>(args: {
  finalized: BrowserFinalizedStoredProfile;
  persistProfile: BrowserPersistFinalizedProfile<TProfile>;
} & BrowserSaveActivateOptions<TRuntime>): Promise<BrowserProfileSaveResult<TProfile, TRuntime>> {
  let profile: TProfile;
  try {
    profile = await args.persistProfile({
      finalized: args.finalized,
      password: args.finalized.storedPassword,
    });
  } catch (error) {
    logger.error('profile', 'persist_failed', {
      flow_kind: args.finalized.source,
      stage: 'persist',
      profile_id: args.finalized.summary.id,
      error_message: toErrorMessage(error, 'failed to persist finalized browser profile'),
    });
    throw error;
  }

  return await saveBrowserProfileAndMaybeActivate({
    profile,
    autoStart: args.autoStart,
    activate: args.activate,
    runtimeUnavailableMessage: args.runtimeUnavailableMessage,
    onRuntimeUnavailable: args.onRuntimeUnavailable,
  });
}

export function logSharedSaveFailure(input: {
  flowKind: string;
  stage: 'decode' | 'finalize' | 'reconstruct';
  profileId?: string | null;
  error: unknown;
}) {
  logger.error('profile', `${input.stage}_failed`, {
    flow_kind: input.flowKind,
    stage: input.stage,
    profile_id: input.profileId ?? undefined,
    error_message: toErrorMessage(input.error, `failed during ${input.stage}`),
  });
}
