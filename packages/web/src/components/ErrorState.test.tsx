// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ErrorState } from './ErrorState';

vi.mock('./ui/Button', () => ({
  Button: ({ children, onClick, disabled, type, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} type={type} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('lucide-react', () => ({
  AlertCircle: (props: any) => <svg data-testid="alert-circle-icon" {...props} />,
}));

// Custom icon for the icon-prop test.
const CustomIcon = (props: any) => <svg data-testid="custom-icon" {...props} />;

describe('ErrorState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it('renders the default error message and title', () => {
    render(<ErrorState />);

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText("We couldn't load this content. Please try again.")).toBeTruthy();
  });

  it('renders a custom title and description when provided', () => {
    render(<ErrorState title="Connection lost" description="Please check your network." />);

    expect(screen.getByText('Connection lost')).toBeTruthy();
    expect(screen.getByText('Please check your network.')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('renders the Retry button when onRetry is provided', () => {
    render(<ErrorState onRetry={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('does NOT render the Retry button when onRetry is omitted', () => {
    render(<ErrorState />);

    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('clicking the Retry button calls onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('exposes role="alert" on the root container for assistive tech', () => {
    render(<ErrorState />);

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders the default AlertCircle icon when no icon prop is passed', () => {
    render(<ErrorState />);

    expect(screen.getByTestId('alert-circle-icon')).toBeTruthy();
  });

  it('renders a custom icon when the icon prop is passed', () => {
    render(<ErrorState icon={CustomIcon} />);

    expect(screen.getByTestId('custom-icon')).toBeTruthy();
    expect(screen.queryByTestId('alert-circle-icon')).toBeNull();
  });

  it('passes aria-hidden to the icon', () => {
    render(<ErrorState />);

    const icon = screen.getByTestId('alert-circle-icon');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });
});
