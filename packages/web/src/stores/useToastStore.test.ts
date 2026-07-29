import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToastStore } from './useToastStore';

describe('useToastStore', () => {
  beforeEach(() => {
    vi.useRealTimers();
    useToastStore.setState({ toasts: [] });
  });

  it('addToast adds a toast to the list', () => {
    useToastStore.getState().addToast('success', 'test message');

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].message).toBe('test message');
    expect(toasts[0].id).toEqual(expect.any(String));
    expect(toasts[0].removing).toBeUndefined();
  });

  it('removeToast removes the toast by ID after the exit animation', () => {
    vi.useFakeTimers();
    useToastStore.getState().addToast('success', 'test');
    const id = useToastStore.getState().toasts[0].id;

    useToastStore.getState().removeToast(id);

    // The toast is still in the list but flagged for exit animation.
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].removing).toBe(true);

    // After the EXIT_DURATION (300ms), the toast is actually removed.
    vi.advanceTimersByTime(300);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('auto-removes the toast after 5s', () => {
    vi.useFakeTimers();
    useToastStore.getState().addToast('success', 'test');
    expect(useToastStore.getState().toasts).toHaveLength(1);

    // After 5s, the auto-remove callback fires removeToast — which only
    // MARKS the toast as removing (exit animation), then schedules the
    // actual removal 300ms later.
    vi.advanceTimersByTime(5000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].removing).toBe(true);

    vi.advanceTimersByTime(300);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('removing flag is set before actual removal (exit animation)', () => {
    vi.useFakeTimers();
    useToastStore.getState().addToast('success', 'test');
    const id = useToastStore.getState().toasts[0].id;

    useToastStore.getState().removeToast(id);

    expect(useToastStore.getState().toasts[0].removing).toBe(true);
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(300);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('multiple toasts coexist', () => {
    useToastStore.getState().addToast('success', 'one');
    useToastStore.getState().addToast('error', 'two');
    useToastStore.getState().addToast('info', 'three');

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(3);
    expect(toasts.map((t) => t.message)).toEqual(['one', 'two', 'three']);
    expect(toasts.map((t) => t.type)).toEqual(['success', 'error', 'info']);
    expect(toasts.map((t) => t.id)).toEqual([
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ]);
    // All three IDs are distinct.
    expect(new Set(toasts.map((t) => t.id)).size).toBe(3);
  });

  it('removeToast is a no-op for an unknown ID', () => {
    useToastStore.getState().addToast('success', 'test');
    useToastStore.getState().removeToast('nonexistent-id');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].removing).toBeUndefined();
  });

  it('removeToast is a no-op when the toast is already removing', () => {
    vi.useFakeTimers();
    useToastStore.getState().addToast('success', 'test');
    const id = useToastStore.getState().toasts[0].id;

    useToastStore.getState().removeToast(id);
    expect(useToastStore.getState().toasts[0].removing).toBe(true);

    // Calling again should not schedule another exit timer.
    useToastStore.getState().removeToast(id);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].removing).toBe(true);

    // The original 300ms timer still fires.
    vi.advanceTimersByTime(300);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('addToast with different toast types', () => {
    useToastStore.getState().addToast('warning', 'careful');
    expect(useToastStore.getState().toasts[0].type).toBe('warning');
    expect(useToastStore.getState().toasts[0].message).toBe('careful');
  });
});
