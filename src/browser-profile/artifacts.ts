import type { BrowserProfileArtifactRefs } from './types';

export function createBrowserProfileArtifactRefs(
  profileId: string,
  namespace = 'browser-profile',
): BrowserProfileArtifactRefs {
  const normalizedId = profileId.trim().toLowerCase();
  return {
    groupRef: `${namespace}:${normalizedId}:group`,
    encryptedProfileRef: `${namespace}:${normalizedId}:encrypted-profile`,
    statePath: `${namespace}:${normalizedId}:state`,
  };
}
