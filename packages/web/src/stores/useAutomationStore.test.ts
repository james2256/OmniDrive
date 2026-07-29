import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { useAutomationStore } from './useAutomationStore';
import { automationsApi } from '../lib/api/automations';

vi.mock('../lib/api/automations', () => ({
  automationsApi: {
    getAutomations: vi.fn(),
    toggleAutomation: vi.fn(),
  },
}));

describe('useAutomationStore', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    useAutomationStore.setState({ rules: [], isLoading: false, error: null });
    (automationsApi.getAutomations as Mock).mockResolvedValue({ rules: [] });
    (automationsApi.toggleAutomation as Mock).mockResolvedValue(undefined);
    // The source logs caught errors via `console.error` in both catch blocks
    // — silence it so the test output stays clean.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('has the correct initial state', () => {
    const state = useAutomationStore.getState();
    expect(state.rules).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(typeof state.fetchRules).toBe('function');
    expect(typeof state.toggleRule).toBe('function');
  });

  it('fetchRules loads automations from the API and clears isLoading', async () => {
    const rules = [
      { id: 'r1', name: 'Auto 1', triggerType: 'upload', isActive: true },
      { id: 'r2', name: 'Auto 2', triggerType: 'delete', isActive: false },
    ];
    (automationsApi.getAutomations as Mock).mockResolvedValue({ rules });

    await useAutomationStore.getState().fetchRules();

    expect(automationsApi.getAutomations).toHaveBeenCalledTimes(1);
    expect(useAutomationStore.getState().rules).toEqual(rules);
    expect(useAutomationStore.getState().isLoading).toBe(false);
    expect(useAutomationStore.getState().error).toBeNull();
  });

  it('fetchRules sets isLoading=true during the request', async () => {
    let resolveGet: (v: { rules: unknown[] }) => void;
    (automationsApi.getAutomations as Mock).mockImplementation(
      () =>
        new Promise((r) => {
          resolveGet = r;
        }),
    );

    const fetchPromise = useAutomationStore.getState().fetchRules();
    expect(useAutomationStore.getState().isLoading).toBe(true);
    expect(useAutomationStore.getState().error).toBeNull();

    resolveGet!({ rules: [] });
    await fetchPromise;
    expect(useAutomationStore.getState().isLoading).toBe(false);
  });

  it('fetchRules sets error on API failure (Error instance)', async () => {
    (automationsApi.getAutomations as Mock).mockRejectedValue(new Error('Network failed'));

    await useAutomationStore.getState().fetchRules();

    expect(useAutomationStore.getState().error).toBe('Network failed');
    expect(useAutomationStore.getState().isLoading).toBe(false);
    expect(useAutomationStore.getState().rules).toEqual([]);
  });

  it('fetchRules sets a generic error message for non-Error throws', async () => {
    (automationsApi.getAutomations as Mock).mockRejectedValue('unexpected string');

    await useAutomationStore.getState().fetchRules();

    expect(useAutomationStore.getState().error).toBe('Failed to fetch rules');
    expect(useAutomationStore.getState().isLoading).toBe(false);
  });

  it('toggleRule optimistically updates the rule before the API call', async () => {
    useAutomationStore.setState({
      rules: [{ id: 'r1', name: 'Auto 1', triggerType: 'upload', isActive: false }],
    });

    const togglePromise = useAutomationStore.getState().toggleRule('r1', true);

    // Optimistic update: the rule's isActive is now true, before the API returns.
    expect(useAutomationStore.getState().rules[0].isActive).toBe(true);

    await togglePromise;

    // The API was called with the new state.
    expect(automationsApi.toggleAutomation).toHaveBeenCalledWith('r1', true);
    // State remains optimistic-true after the successful API call (no revert).
    expect(useAutomationStore.getState().rules[0].isActive).toBe(true);
    expect(useAutomationStore.getState().error).toBeNull();
  });

  it('toggleRule reverts the optimistic update on API error (Error instance)', async () => {
    useAutomationStore.setState({
      rules: [{ id: 'r1', name: 'Auto 1', triggerType: 'upload', isActive: false }],
    });
    (automationsApi.toggleAutomation as Mock).mockRejectedValue(new Error('API down'));

    await useAutomationStore.getState().toggleRule('r1', true);

    // Reverted: isActive back to false (the original).
    expect(useAutomationStore.getState().rules[0].isActive).toBe(false);
    expect(useAutomationStore.getState().error).toBe('API down');
  });

  it('toggleRule reverts with a generic error message for non-Error throws', async () => {
    useAutomationStore.setState({
      rules: [{ id: 'r1', name: 'Auto 1', triggerType: 'upload', isActive: true }],
    });
    (automationsApi.toggleAutomation as Mock).mockRejectedValue('oops');

    await useAutomationStore.getState().toggleRule('r1', false);

    expect(useAutomationStore.getState().rules[0].isActive).toBe(true);
    expect(useAutomationStore.getState().error).toBe('Failed to update rule');
  });

  it('toggleRule only updates the matching rule (other rules unchanged)', async () => {
    useAutomationStore.setState({
      rules: [
        { id: 'r1', name: 'Auto 1', triggerType: 'upload', isActive: false },
        { id: 'r2', name: 'Auto 2', triggerType: 'delete', isActive: false },
      ],
    });

    await useAutomationStore.getState().toggleRule('r1', true);

    expect(useAutomationStore.getState().rules[0].isActive).toBe(true);
    expect(useAutomationStore.getState().rules[1].isActive).toBe(false);
  });

  it('toggleRule is a no-op (no revert) when the rule ID is not found', async () => {
    useAutomationStore.setState({ rules: [] });

    await useAutomationStore.getState().toggleRule('unknown', true);

    expect(automationsApi.toggleAutomation).toHaveBeenCalledWith('unknown', true);
    expect(useAutomationStore.getState().rules).toEqual([]);
    expect(useAutomationStore.getState().error).toBeNull();
  });
});
