import type { BrowserProfilePreview } from '../core';
import type { BrowserProfilePackagePayload } from '../../profile-package';

export type BrowserImportedProfilePackage = {
  source: 'bfprofile';
  payload: BrowserProfilePackagePayload;
  preview: BrowserProfilePreview;
  profileString: string;
  shareString: string;
};
