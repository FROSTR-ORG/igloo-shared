import type { BrowserProfileSaveResult, BrowserRuntimeWarning } from './types';
import { createRuntimeUnavailableWarning } from './warning';

export async function completeBrowserProfileSave<TProfile, TRuntime>(args: {
  profile: TProfile;
  autoStart?: boolean;
  activate?: () => Promise<TRuntime>;
  runtimeUnavailableMessage?: string;
  onRuntimeUnavailable?: (warning: BrowserRuntimeWarning) => void | Promise<void>;
}): Promise<BrowserProfileSaveResult<TProfile, TRuntime>> {
  if (!args.autoStart || !args.activate) {
    return {
      profile: args.profile,
      runtime: null,
      runtimeWarning: null,
    };
  }

  try {
    return {
      profile: args.profile,
      runtime: await args.activate(),
      runtimeWarning: null,
    };
  } catch (error) {
    const runtimeWarning = createRuntimeUnavailableWarning(error, args.runtimeUnavailableMessage);
    await args.onRuntimeUnavailable?.(runtimeWarning);
    return {
      profile: args.profile,
      runtime: null,
      runtimeWarning,
    };
  }
}
