import { describe, expect, test, vi } from 'vitest';

import { createLogger, createObservabilityBuffer } from './observability';

describe('observability logger', () => {
  test('default level keeps info events visible for the PWA event log', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const buffer = createObservabilityBuffer();
    const logger = createLogger('test.component', buffer);

    logger.info('sign', 'complete', {
      request_id: 'req-1',
      signature_count: 1,
      message: 'Sign request completed',
    });
    logger.debug('runtime', 'status_event', {
      kind: 'sign',
      sign_ready: true,
      ecdh_ready: true,
      pending_ops: 0,
    });

    expect(logger.level).toBe('info');
    expect(buffer.snapshot()).toHaveLength(1);
    expect(buffer.snapshot()[0]).toMatchObject({
      level: 'info',
      domain: 'sign',
      event: 'complete',
      message: 'Sign request completed',
    });

    consoleInfo.mockRestore();
  });
});
