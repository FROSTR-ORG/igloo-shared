import { createBrowserProfilePreview } from '../core';
import {
  createProfilePackagePair,
  decodeBfProfilePackage,
} from '../../profile-package';
import { trimBrowserPackageText } from './common';
import type { BrowserImportedProfilePackage } from './types';

export async function importBrowserProfilePackage(
  packageText: string,
  password: string,
): Promise<BrowserImportedProfilePackage> {
  const normalizedPackageText = trimBrowserPackageText(packageText);
  const payload = await decodeBfProfilePackage(normalizedPackageText, password);
  const preview = createBrowserProfilePreview(payload, 'bfprofile');
  const { shareString } = await createProfilePackagePair(payload, password);
  return {
    source: 'bfprofile',
    payload,
    preview,
    profileString: normalizedPackageText,
    shareString,
  };
}
