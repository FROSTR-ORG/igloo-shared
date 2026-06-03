import {
  completeBrowserProfileSave,
  type BrowserProfileSaveResult,
  type BrowserRuntimeWarning,
} from '../session-orchestration';
import { importBrowserProfilePackage } from './imports';
import type { BrowserImportedProfilePackage } from './types';

export async function importAndSaveBrowserProfilePackage<TProfile, TRuntime>(args: {
  packageText: string;
  password: string;
  autoStart?: boolean;
  activate?: () => Promise<TRuntime>;
  runtimeUnavailableMessage?: string;
  onRuntimeUnavailable?: (warning: BrowserRuntimeWarning) => void | Promise<void>;
  storeProfile: (input: {
    imported: BrowserImportedProfilePackage;
    password: string;
  }) => Promise<TProfile>;
}): Promise<BrowserProfileSaveResult<TProfile, TRuntime>> {
  const imported = await importBrowserProfilePackage(args.packageText, args.password);
  const profile = await args.storeProfile({
    imported,
    password: args.password,
  });
  return await completeBrowserProfileSave({
    profile,
    autoStart: args.autoStart,
    activate: args.activate,
    runtimeUnavailableMessage: args.runtimeUnavailableMessage,
    onRuntimeUnavailable: args.onRuntimeUnavailable,
  });
}
