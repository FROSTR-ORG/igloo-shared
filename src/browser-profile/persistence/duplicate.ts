import type { BrowserDuplicateProfileInput } from './types';

export function duplicateBrowserProfileMessage(input: BrowserDuplicateProfileInput) {
  return `Device profile ${input.label} (${input.profileId.slice(0, 8)}) already exists.`;
}

export function assertBrowserProfileIdAvailable(input: BrowserDuplicateProfileInput) {
  if (input.existingProfileIds?.includes(input.profileId)) {
    throw new Error(duplicateBrowserProfileMessage(input));
  }
}
