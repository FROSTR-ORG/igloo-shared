import type { createBrowserStoredProfileProjection } from '../store/projection';

export type BrowserPersistedProfileBundle = {
  projection: ReturnType<typeof createBrowserStoredProfileProjection>;
  profileString: string;
  shareString: string;
};

export type BrowserDuplicateProfileInput = {
  existingProfileIds?: string[] | null;
  profileId: string;
  label: string;
};
