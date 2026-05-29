import { createBrowserProfilePreview } from '../core';
import { createProfilePackagePair } from '../../profile-package';
import { recoverProfileFromSharePackage } from '../../profile-backup-host';
import { trimBrowserPackageText } from './common';
import type { BrowserRecoveredProfilePackage } from './types';

export async function recoverBrowserProfilePackage(
  packageText: string,
  password: string,
): Promise<BrowserRecoveredProfilePackage> {
  const normalizedPackageText = trimBrowserPackageText(packageText);
  const recovered = await recoverProfileFromSharePackage(normalizedPackageText, password);
  const preview = createBrowserProfilePreview(recovered.profile, 'bfshare');
  const { profileString } = await createProfilePackagePair(recovered.profile, password);
  return {
    source: 'bfshare',
    payload: recovered.profile,
    preview,
    profileString,
    shareString: normalizedPackageText,
  };
}
