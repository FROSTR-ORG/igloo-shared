export type RelayPingResult = {
  /** Round-trip time to open the WebSocket connection, in milliseconds. */
  latencyMs?: number;
  /** Set when the connection could not be opened (failure or timeout). */
  error?: string;
};

/**
 * Measure a relay's connection latency by opening a WebSocket and timing how
 * long it takes to reach the `open` state. A failure to open (error or timeout)
 * is reported as a connection failure. Browser-only (relies on the global
 * `WebSocket`).
 */
export function pingRelay(url: string, timeoutMs = 5000): Promise<RelayPingResult> {
  return new Promise<RelayPingResult>((resolve) => {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let settled = false;
    let socket: WebSocket | null = null;

    const finish = (result: RelayPingResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // ignore close errors
      }
      resolve(result);
    };

    const timer = window.setTimeout(() => finish({ error: 'Connection timed out' }), timeoutMs);

    try {
      socket = new WebSocket(url);
    } catch (error) {
      finish({ error: error instanceof Error ? error.message : 'Connection failed' });
      return;
    }

    socket.onopen = () => {
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
      finish({ latencyMs: Math.round(elapsed) });
    };
    socket.onerror = () => finish({ error: 'Connection failed' });
  });
}
