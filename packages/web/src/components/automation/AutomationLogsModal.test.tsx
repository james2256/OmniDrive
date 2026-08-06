// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AutomationLogsModal } from './AutomationLogsModal';

const useAutomationLogsMock = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useAutomations', () => ({
  useAutomationLogs: useAutomationLogsMock,
}));

vi.mock('../ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('../ui/Button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('../../lib/utils', () => ({
  formatAbsoluteDate: (d: string) => `DATE:${d}`,
}));

vi.mock('lucide-react', () => ({
  CheckCircle2: () => <svg data-testid="ok" />,
  XCircle: () => <svg data-testid="err" />,
  ScrollText: () => <svg />,
}));

describe('AutomationLogsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAutomationLogsMock.mockReturnValue({ logs: [], isLoading: false, error: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing when ruleId is null', () => {
    render(<AutomationLogsModal ruleId={null} ruleName={null} onClose={vi.fn()} />);
    expect(screen.queryByTestId('dialog')).toBeNull();
  });

  it('renders loading state', () => {
    useAutomationLogsMock.mockReturnValue({ logs: [], isLoading: true, error: null });
    render(<AutomationLogsModal ruleId="r1" ruleName="My rule" onClose={vi.fn()} />);
    expect(screen.getByText('Loading logs...')).toBeTruthy();
  });

  it('renders empty state when no logs', () => {
    render(<AutomationLogsModal ruleId="r1" ruleName="My rule" onClose={vi.fn()} />);
    expect(screen.getByText(/No execution logs yet/)).toBeTruthy();
  });

  it('renders error state', () => {
    useAutomationLogsMock.mockReturnValue({ logs: [], isLoading: false, error: new Error('x') });
    render(<AutomationLogsModal ruleId="r1" ruleName="My rule" onClose={vi.fn()} />);
    expect(screen.getByText('Failed to load logs.')).toBeTruthy();
  });

  it('renders logs with status icon, status text, date, and details', () => {
    useAutomationLogsMock.mockReturnValue({
      logs: [
        {
          id: 'log-1',
          ruleId: 'r1',
          status: 'success',
          details: '{"fileId":"f-1"}',
          executedAt: '2026-08-06 14:23:00',
        },
        {
          id: 'log-2',
          ruleId: 'r1',
          status: 'error',
          details: 'Google API failed',
          executedAt: '2026-08-06 14:15:00',
        },
      ],
      isLoading: false,
      error: null,
    });
    render(<AutomationLogsModal ruleId="r1" ruleName="My rule" onClose={vi.fn()} />);
    expect(screen.getAllByTestId('ok')).toHaveLength(1);
    expect(screen.getAllByTestId('err')).toHaveLength(1);
    expect(screen.getByText('{"fileId":"f-1"}')).toBeTruthy();
    expect(screen.getByText('Google API failed')).toBeTruthy();
    expect(screen.getByText('DATE:2026-08-06 14:23:00')).toBeTruthy();
    expect(screen.getByText('DATE:2026-08-06 14:15:00')).toBeTruthy();
  });

  it('includes the rule name in the title when provided', () => {
    render(<AutomationLogsModal ruleId="r1" ruleName="Auto-archive" onClose={vi.fn()} />);
    expect(screen.getByText('Execution Logs: Auto-archive')).toBeTruthy();
  });
});
