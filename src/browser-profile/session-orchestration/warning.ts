import type { BrowserRuntimeWarning } from './types';
import { toErrorMessage } from '../../runtime-internal';

export function createRuntimeUnavailableWarning(
  error: unknown,
  message = 'Profile saved, but the signer is unavailable. Start it again when relays are reachable.',
): BrowserRuntimeWarning {
  const detail = toErrorMessage(error, '') || undefined;
  return {
    code: 'runtime_unavailable',
    message,
    detail,
  };
}
