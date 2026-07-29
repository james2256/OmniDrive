import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lazyWithRetry } from './lazyWithRetry';

// `lazyWithRetry` wraps `React.lazy()` so that the first import failure
// (typical after a deploy when a stale index.html references a 404 chunk)
// triggers a single `window.location.reload()` to fetch fresh chunks, then
// re-throws. A `sessionStorage` flag guards against infinite reload loops.
//
// To test the loader's behavior, we tap into the React.lazy return shape:
// `{ $$typeof, _payload: { _status, _result: factory }, _init }`. `_result`
// is the factory function we pass to `lazy()` — calling it exercises the
// catch/reload branch without rendering a Suspense boundary.
//
// Note on `window.location.reload`: jsdom defines it as a non-writable,
// non-configurable own property on the `Location` instance, so `vi.spyOn`
// fails with "Cannot redefine property: reload". We work around this by
// replacing the entire `window.location` object (which IS configurable) with
// a plain clone carrying a `reload` mock, then restoring it in `afterEach`.

describe('lazyWithRetry', () => {
  let originalLocation: Location;
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    originalLocation = window.location;
    reloadSpy = vi.fn();
    const mock = { ...originalLocation, reload: reloadSpy } as unknown as Location;
    Object.defineProperty(window, 'location', {
      value: mock,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
      writable: true,
    });
  });

  it('returns a React lazy component', () => {
    const Lazy = lazyWithRetry(() => Promise.resolve({ default: () => null }));
    expect(Lazy).toHaveProperty('$$typeof');
    // React.lazy's $$typeof is a Symbol — verify it's a symbol
    expect(typeof (Lazy as any).$$typeof).toBe('symbol');
    // `_init` is the lazy initializer React attaches
    expect(typeof (Lazy as any)._init).toBe('function');
  });

  it('resolves the loader on successful import', async () => {
    const DefaultComp = () => null;
    const importFn = vi.fn(() => Promise.resolve({ default: DefaultComp }));
    const Lazy = lazyWithRetry(importFn);
    const factory = (Lazy as any)._payload._result as () => Promise<{
      default: typeof DefaultComp;
    }>;
    const mod = await factory();
    expect(importFn).toHaveBeenCalledTimes(1);
    expect(mod.default).toBe(DefaultComp);
  });

  it('does not reload on successful import', async () => {
    const importFn = vi.fn(() => Promise.resolve({ default: () => null }));
    const Lazy = lazyWithRetry(importFn);
    const factory = (Lazy as any)._payload._result;
    await factory();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('chunk-retry')).toBeNull();
  });

  it('reloads the page on first import failure and sets the chunk-retry flag', async () => {
    const importFn = vi.fn(() =>
      Promise.reject(new Error('Failed to fetch dynamically imported module: 404')),
    );
    const Lazy = lazyWithRetry(importFn);
    const factory = (Lazy as any)._payload._result;
    await expect(factory()).rejects.toThrow('Failed to fetch dynamically imported module: 404');
    expect(sessionStorage.getItem('chunk-retry')).toBe('1');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('does not reload on a second import failure once the chunk-retry flag is set', async () => {
    sessionStorage.setItem('chunk-retry', '1');
    const importFn = vi.fn(() => Promise.reject(new Error('chunk 404')));
    const Lazy = lazyWithRetry(importFn);
    const factory = (Lazy as any)._payload._result;
    await expect(factory()).rejects.toThrow('chunk 404');
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('max retries = 1: subsequent failures after the first reload still propagate the error', async () => {
    // First failure → sets flag, reloads, re-throws.
    const failingImport = () => Promise.reject(new Error('still broken'));
    const Lazy = lazyWithRetry(failingImport);
    const factory = (Lazy as any)._payload._result;
    await expect(factory()).rejects.toThrow('still broken');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    // Second failure (post-reload, flag already set) → no reload, just re-throw.
    await expect(factory()).rejects.toThrow('still broken');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
