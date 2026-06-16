import { createBrowserProfilePreview } from '../core';
import {
  createProfilePackagePair,
  decodeBfProfilePackage,
} from '../../profile-package';
import { Secret } from '../../secret';
import { trimBrowserPackageText } from './common';
import type { BrowserImportedProfilePackage } from './types';

export async function importBrowserProfilePackage(
  packageText: string,
  password: string,
): Promise<BrowserImportedProfilePackage> {
  const normalizedPackageText = trimBrowserPackageText(packageText);
  const passphrase = Secret.of(password);
  const payload = await decodeBfProfilePackage(normalizedPackageText, passphrase);
  const preview = createBrowserProfilePreview(payload, 'bfprofile');
  const { shareString } = await createProfilePackagePair(payload, passphrase);
  return {
    source: 'bfprofile',
    payload,
    preview,
    profileString: normalizedPackageText,
    shareString,
  };
}
