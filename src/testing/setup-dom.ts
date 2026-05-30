// Shared jsdom localStorage shim for the FROSTR repos' unit tests.
//
// jsdom does not always expose a spec-compliant `localStorage` with method
// members across versions (jsdom 28 in particular), so tests that call
// `localStorage.clear()` / `getItem()` need a guaranteed backing store.
// Consumers call `ensureLocalStorage()` from a `beforeEach` in their own setup
// file (so the `beforeEach` is registered against the consumer's own vitest
// instance — this module intentionally has no side effects and no `vitest`
// import to avoid dual-instance hazards across the `file:` submodule link).
//
// This file is the canonical source. It is consumed directly by igloo-pwa and
// igloo-chrome (which link igloo-shared) and COPIED into igloo-ui (which does
// not); the copy is kept in lockstep by scripts/check-shared-test-setup.sh.

export function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.has(key) ? values.get(key) ?? null : null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, String(value));
    },
  };
}

export function ensureLocalStorage(): void {
  const candidate = window.localStorage as Storage | undefined;
  if (
    candidate &&
    typeof candidate.clear === 'function' &&
    typeof candidate.getItem === 'function' &&
    typeof candidate.setItem === 'function' &&
    typeof candidate.removeItem === 'function'
  ) {
    return;
  }

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: createMemoryStorage(),
  });
}
