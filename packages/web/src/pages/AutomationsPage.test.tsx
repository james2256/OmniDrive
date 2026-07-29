// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AutomationsPage } from './AutomationsPage';
import { useAutomationStore } from '../stores/useAutomationStore';

vi.mock('../stores/useAutomationStore', () => ({
  useAutomationStore: vi.fn(),
}));

vi.mock('../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, type, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} type={type} {...props}>
      {children}
    </button>
  ),
}));

describe('AutomationsPage', () => {
  const fetchRules = vi.fn();
  const toggleRule = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useAutomationStore as unknown as Mock).mockReturnValue({
      rules: [],
      fetchRules,
      toggleRule,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders page title "Automation Rules"', () => {
    render(<AutomationsPage />);

    expect(screen.getByText('Automation Rules')).toBeTruthy();
  });

  it('calls fetchRules on mount', () => {
    render(<AutomationsPage />);

    expect(fetchRules).toHaveBeenCalledTimes(1);
  });

  it('renders loading state when isLoading is true', () => {
    (useAutomationStore as unknown as Mock).mockReturnValue({
      rules: [],
      fetchRules,
      toggleRule,
      isLoading: true,
      error: null,
    });

    render(<AutomationsPage />);

    expect(screen.getByText('Loading rules...')).toBeTruthy();
  });

  it('renders empty state when there are no rules', () => {
    render(<AutomationsPage />);

    expect(screen.getByText('No automation rules yet.')).toBeTruthy();
  });

  it('renders error banner when error is set', () => {
    (useAutomationStore as unknown as Mock).mockReturnValue({
      rules: [],
      fetchRules,
      toggleRule,
      isLoading: false,
      error: 'Failed to fetch rules',
    });

    render(<AutomationsPage />);

    expect(screen.getByText('Failed to fetch rules')).toBeTruthy();
  });

  it('renders a list of automation rules with name, trigger type, and Active/Inactive button', () => {
    (useAutomationStore as unknown as Mock).mockReturnValue({
      rules: [
        { id: 'r1', name: 'Auto-share PDFs', triggerType: 'file_created', isActive: true },
        { id: 'r2', name: 'Cleanup expired', triggerType: 'scheduled', isActive: false },
      ],
      fetchRules,
      toggleRule,
      isLoading: false,
      error: null,
    });

    render(<AutomationsPage />);

    expect(screen.getByText('Auto-share PDFs')).toBeTruthy();
    expect(screen.getByText('file_created')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();

    expect(screen.getByText('Cleanup expired')).toBeTruthy();
    expect(screen.getByText('scheduled')).toBeTruthy();
    expect(screen.getByText('Inactive')).toBeTruthy();
  });

  it('toggles a rule when its Active/Inactive button is clicked (calls toggleRule with inverted state)', () => {
    (useAutomationStore as unknown as Mock).mockReturnValue({
      rules: [{ id: 'r1', name: 'Auto-share PDFs', triggerType: 'file_created', isActive: true }],
      fetchRules,
      toggleRule,
      isLoading: false,
      error: null,
    });

    render(<AutomationsPage />);

    fireEvent.click(screen.getByText('Active'));

    expect(toggleRule).toHaveBeenCalledWith('r1', false);
  });

  it('toggles an inactive rule to active when Inactive button clicked', () => {
    (useAutomationStore as unknown as Mock).mockReturnValue({
      rules: [{ id: 'r2', name: 'Cleanup expired', triggerType: 'scheduled', isActive: false }],
      fetchRules,
      toggleRule,
      isLoading: false,
      error: null,
    });

    render(<AutomationsPage />);

    fireEvent.click(screen.getByText('Inactive'));

    expect(toggleRule).toHaveBeenCalledWith('r2', true);
  });

  it('renders trigger type with capitalized first letter (capitalize class is applied)', () => {
    (useAutomationStore as unknown as Mock).mockReturnValue({
      rules: [{ id: 'r1', name: 'Auto-share', triggerType: 'file_created', isActive: true }],
      fetchRules,
      toggleRule,
      isLoading: false,
      error: null,
    });

    render(<AutomationsPage />);

    // The triggerType is rendered as text inside a <span className="capitalize">.
    expect(screen.getByText('file_created')).toBeTruthy();
    const triggerSpan = screen.getByText('file_created');
    // Source wraps the triggerType in <span className="capitalize">{rule.triggerType}</span>
    expect(triggerSpan.tagName).toBe('SPAN');
    expect(triggerSpan.className).toContain('capitalize');
  });

  it('re-renders multiple rules each with their own toggle button', () => {
    (useAutomationStore as unknown as Mock).mockReturnValue({
      rules: [
        { id: 'r1', name: 'Rule A', triggerType: 'file_created', isActive: true },
        { id: 'r2', name: 'Rule B', triggerType: 'scheduled', isActive: true },
        { id: 'r3', name: 'Rule C', triggerType: 'manual', isActive: false },
      ],
      fetchRules,
      toggleRule,
      isLoading: false,
      error: null,
    });

    render(<AutomationsPage />);

    // Three toggle buttons: two "Active" + one "Inactive"
    const activeButtons = screen.getAllByText('Active');
    const inactiveButtons = screen.getAllByText('Inactive');
    expect(activeButtons).toHaveLength(2);
    expect(inactiveButtons).toHaveLength(1);

    // Click first "Active" button → toggles r1 to inactive
    fireEvent.click(activeButtons[0]);
    expect(toggleRule).toHaveBeenLastCalledWith('r1', false);
  });

  it('does not render rule list while loading', () => {
    (useAutomationStore as unknown as Mock).mockReturnValue({
      rules: [{ id: 'r1', name: 'Auto-share', triggerType: 'file_created', isActive: true }],
      fetchRules,
      toggleRule,
      isLoading: true,
      error: null,
    });

    render(<AutomationsPage />);

    expect(screen.queryByText('Auto-share')).toBeNull();
    expect(screen.getByText('Loading rules...')).toBeTruthy();
  });

  it('renders neither loading nor empty state when rules exist (shows rule list instead)', () => {
    (useAutomationStore as unknown as Mock).mockReturnValue({
      rules: [{ id: 'r1', name: 'Auto-share', triggerType: 'file_created', isActive: true }],
      fetchRules,
      toggleRule,
      isLoading: false,
      error: null,
    });

    render(<AutomationsPage />);

    expect(screen.queryByText('Loading rules...')).toBeNull();
    expect(screen.queryByText('No automation rules yet.')).toBeNull();
    expect(screen.getByText('Auto-share')).toBeTruthy();
  });

  it('toggle button click triggers re-render and remains idempotent across multiple clicks', async () => {
    (useAutomationStore as unknown as Mock).mockReturnValue({
      rules: [{ id: 'r1', name: 'Auto-share', triggerType: 'file_created', isActive: true }],
      fetchRules,
      toggleRule,
      isLoading: false,
      error: null,
    });

    render(<AutomationsPage />);

    const button = screen.getByText('Active');
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => {
      expect(toggleRule).toHaveBeenCalledTimes(3);
    });
    expect(toggleRule).toHaveBeenNthCalledWith(1, 'r1', false);
    expect(toggleRule).toHaveBeenNthCalledWith(2, 'r1', false);
    expect(toggleRule).toHaveBeenNthCalledWith(3, 'r1', false);
  });
});
