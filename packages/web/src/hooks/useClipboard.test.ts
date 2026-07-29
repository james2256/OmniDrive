// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClipboard } from './useClipboard';

describe('useClipboard', () => {
  let writeText: ReturnType<typeof vi.fn>;
  let execCommandSpy: ReturnType<typeof vi.fn>;
  let originalClipboard: Clipboard | undefined;
  let originalExecCommand: typeof document.execCommand;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Preserve the original navigator.clipboard so afterEach can restore.
    originalClipboard = navigator.clipboard;
    originalExecCommand = document.execCommand;
    // Default to a working clipboard API for most tests.
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    // jsdom's execCommand logs "Not implemented" — silently stub it.
    execCommandSpy = vi.fn().mockReturnValue(true);
    document.execCommand = execCommandSpy as unknown as typeof document.execCommand;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalClipboard === undefined) {
      // Restore by deleting the property we added.
      // @ts-expect-error — jsdom allows delete on configurable props.
      delete navigator.clipboard;
    } else {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      });
    }
    document.execCommand = originalExecCommand;
  });

  it('copy calls navigator.clipboard.writeText with the text', async () => {
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copy('hello world', 'id-1');
    });

    expect(writeText).toHaveBeenCalledWith('hello world');
  });

  it('sets copiedId on success', async () => {
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copy('hello', 'id-1');
    });

    expect(result.current.copiedId).toBe('id-1');
    expect(result.current.error).toBe('');
  });

  it('sets copiedId to null when no id is provided', async () => {
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copy('hello');
    });

    expect(result.current.copiedId).toBeNull();
  });

  it('clears copiedId after the timeout', async () => {
    const { result } = renderHook(() => useClipboard(1000));

    await act(async () => {
      await result.current.copy('hello', 'id-1');
    });
    expect(result.current.copiedId).toBe('id-1');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.copiedId).toBeNull();
  });

  it('clears the previous timer when copy is called twice before timeout', async () => {
    const { result } = renderHook(() => useClipboard(2000));

    await act(async () => {
      await result.current.copy('one', 'id-1');
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.copiedId).toBe('id-1');

    await act(async () => {
      await result.current.copy('two', 'id-2');
    });
    expect(result.current.copiedId).toBe('id-2');

    // Advance past the FIRST timeout — should not clear because the timer
    // was cleared + restarted by the second copy() call.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.copiedId).toBe('id-2');

    // Advance past the SECOND timeout — now clears.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.copiedId).toBeNull();
  });

  it('handles clipboard API failure (navigator.clipboard undefined) — falls back to execCommand', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copy('hello', 'id-1');
    });

    expect(execCommandSpy).toHaveBeenCalledWith('copy');
    expect(result.current.copiedId).toBe('id-1');
    expect(result.current.error).toBe('');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('sets error when the clipboard API rejects', async () => {
    writeText.mockRejectedValue(new Error('NotAllowed'));
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copy('hello', 'id-1');
    });

    expect(result.current.error).toBe('Failed to copy to clipboard');
    expect(result.current.copiedId).toBeNull();
  });

  it('sets error when the execCommand fallback throws', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    execCommandSpy.mockImplementation(() => {
      throw new Error('execCommand failed');
    });

    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copy('hello', 'id-1');
    });

    expect(result.current.error).toBe('Failed to copy to clipboard');
    expect(result.current.copiedId).toBeNull();
  });

  it('copiedId tracks the last copied ID', async () => {
    const { result } = renderHook(() => useClipboard(5000));

    await act(async () => {
      await result.current.copy('text-1', 'id-1');
    });
    expect(result.current.copiedId).toBe('id-1');

    await act(async () => {
      await result.current.copy('text-2', 'id-2');
    });
    expect(result.current.copiedId).toBe('id-2');

    await act(async () => {
      await result.current.copy('text-3', 'id-3');
    });
    expect(result.current.copiedId).toBe('id-3');
  });

  it('clears the timer on unmount (no setState after unmount)', async () => {
    const { result, unmount } = renderHook(() => useClipboard(1000));

    await act(async () => {
      await result.current.copy('hello', 'id-1');
    });
    expect(result.current.copiedId).toBe('id-1');

    unmount();

    // Advancing timers after unmount should not throw "setState on unmounted"
    // — the useEffect cleanup clears the timer.
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }).not.toThrow();
  });
});
