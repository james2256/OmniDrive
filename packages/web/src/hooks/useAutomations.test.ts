// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useToggleAutomation } from './useAutomations';
import { automationsApi } from '../lib/api/automations';
import { useToastStore } from '../stores/useToastStore';

const captured = vi.hoisted(() => ({
  mutations: [] as Array<{ mutate: ReturnType<typeof vi.fn>; options: any }>,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn((options: any) => {
    const mutate = vi.fn((vars: any) => {
      Promise.resolve(options.mutationFn(vars))
        .then((r: any) => options.onSuccess?.(r, vars, undefined))
        .catch((e: any) => options.onError?.(e, vars, undefined));
    });
    captured.mutations.push({ mutate, options });
    return {
      mutate,
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    };
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('../lib/api/automations', () => ({
  automationsApi: {
    toggleAutomation: vi.fn(),
  },
}));

vi.mock('../stores/useToastStore', () => ({
  useToastStore: vi.fn(),
}));

describe('useToggleAutomation', () => {
  const addToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    captured.mutations.length = 0;
    (useToastStore as unknown as Mock).mockReturnValue({ addToast });
  });

  it('calls automationsApi.toggleAutomation and invalidates on success', async () => {
    (automationsApi.toggleAutomation as Mock).mockResolvedValue(undefined);
    const { result } = renderHook(() => useToggleAutomation());
    result.current.mutate({ id: 'rule-1', isActive: false });

    await waitFor(() => {
      expect(automationsApi.toggleAutomation).toHaveBeenCalledWith('rule-1', false);
    });
  });

  it('toasts error on API failure', async () => {
    (automationsApi.toggleAutomation as Mock).mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useToggleAutomation());
    result.current.mutate({ id: 'rule-2', isActive: true });

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('error', 'Failed to toggle rule');
    });
  });

  it('does not toast on success', async () => {
    (automationsApi.toggleAutomation as Mock).mockResolvedValue(undefined);
    const { result } = renderHook(() => useToggleAutomation());
    result.current.mutate({ id: 'rule-3', isActive: false });

    await waitFor(() => {
      expect(automationsApi.toggleAutomation).toHaveBeenCalled();
    });
    expect(addToast).not.toHaveBeenCalled();
  });
});
