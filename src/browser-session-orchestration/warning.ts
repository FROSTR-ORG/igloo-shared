import type { BrowserRuntimeWarning } from './types';

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return null;
}

export function createRuntimeUnavailableWarning(
  error: unknown,
  message = 'Profile saved, but the signer is unavailable. Start it again when relays are reachable.',
): BrowserRuntimeWarning {
  const detail = toErrorMessage(error);
  return {
    code: 'runtime_unavailable',
    message,
    detail: detail ?? undefined,
  };
}
