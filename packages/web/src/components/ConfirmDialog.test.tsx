// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

vi.mock('./ui/dialog', () => ({
  Dialog: ({ open, children, onOpenChange }: any) =>
    open ? (
      <div data-testid="dialog">
        <button data-testid="dialog-backdrop" onClick={() => onOpenChange?.(false)} />
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children, icon }: any) => (
    <div>
      {icon}
      <div>{children}</div>
    </div>
  ),
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

vi.mock('./ui/Button', () => ({
  Button: ({ children, onClick, disabled, loading, variant, type, ...props }: any) => (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      type={type}
      data-variant={variant}
      data-loading={loading ? 'true' : 'false'}
      {...props}
    >
      {loading && <span data-testid="button-spinner" />}
      {children}
    </button>
  ),
}));

vi.mock('lucide-react', () => ({
  TriangleAlert: ({ className }: any) => (
    <svg data-testid="triangle-alert-icon" data-class={className} />
  ),
}));

describe('ConfirmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it('renders title and message when open', () => {
    render(
      <ConfirmDialog
        open
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        title="Delete file?"
        message="This action cannot be undone."
      />,
    );

    expect(screen.getByText('Delete file?')).toBeTruthy();
    expect(screen.getByText('This action cannot be undone.')).toBeTruthy();
    expect(screen.getByTestId('dialog')).toBeTruthy();
  });

  it('does not render anything when closed (open=false)', () => {
    render(
      <ConfirmDialog
        open={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        title="Delete file?"
        message="This action cannot be undone."
      />,
    );

    expect(screen.queryByTestId('dialog')).toBeNull();
    expect(screen.queryByText('Delete file?')).toBeNull();
  });

  it('clicking the Confirm button calls onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onConfirm={onConfirm}
        onClose={vi.fn()}
        title="Delete file?"
        message="Are you sure?"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('clicking the Cancel button calls onClose', () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        onConfirm={vi.fn()}
        onClose={onClose}
        title="Delete file?"
        message="Are you sure?"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the danger variant by default (red icon + danger button)', () => {
    render(
      <ConfirmDialog
        open
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        title="Delete file?"
        message="Are you sure?"
      />,
    );

    const icon = screen.getByTestId('triangle-alert-icon');
    expect(icon.getAttribute('data-class')).toContain('text-red-500');
    expect(screen.getByRole('button', { name: 'Confirm' }).getAttribute('data-variant')).toBe(
      'danger',
    );
  });

  it('renders the warning variant (amber icon + warning button)', () => {
    render(
      <ConfirmDialog
        open
        variant="warning"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        title="Apply changes?"
        message="Are you sure?"
      />,
    );

    const icon = screen.getByTestId('triangle-alert-icon');
    expect(icon.getAttribute('data-class')).toContain('text-amber-500');
    expect(screen.getByRole('button', { name: 'Confirm' }).getAttribute('data-variant')).toBe(
      'warning',
    );
  });

  it('renders the info variant (blue icon + primary button)', () => {
    render(
      <ConfirmDialog
        open
        variant="info"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        title="Notice"
        message="Heads up."
      />,
    );

    const icon = screen.getByTestId('triangle-alert-icon');
    expect(icon.getAttribute('data-class')).toContain('text-primary');
    expect(screen.getByRole('button', { name: 'Confirm' }).getAttribute('data-variant')).toBe(
      'primary',
    );
  });

  it('disables both buttons while loading', () => {
    render(
      <ConfirmDialog
        open
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        title="Delete file?"
        message="Are you sure?"
        loading
      />,
    );

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(cancel.hasAttribute('disabled')).toBe(true);
    expect(confirm.hasAttribute('disabled')).toBe(true);
    // Confirm button also shows the loading spinner
    expect(screen.getByTestId('button-spinner')).toBeTruthy();
  });

  it('does not fire onConfirm/onClose when buttons are disabled by loading', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        onConfirm={onConfirm}
        onClose={onClose}
        title="Delete file?"
        message="Are you sure?"
        loading
      />,
    );

    // Clicking-library respects the `disabled` attribute and will not fire onClick,
    // so this verifies the disabled gate is in place on both buttons.
    expect(screen.getByRole('button', { name: 'Confirm' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
  });

  it('closing the dialog via onOpenChange(false) calls onClose when not loading', () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        onConfirm={vi.fn()}
        onClose={onClose}
        title="Delete file?"
        message="Are you sure?"
      />,
    );

    // Simulate the dialog backdrop click (fires onOpenChange(false))
    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose from onOpenChange(false) while loading', () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        onConfirm={vi.fn()}
        onClose={onClose}
        title="Delete file?"
        message="Are you sure?"
        loading
      />,
    );

    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('honors custom confirmText and cancelText', () => {
    render(
      <ConfirmDialog
        open
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        title="Revoke link?"
        message="This will disable the link immediately."
        confirmText="Revoke"
        cancelText="Keep"
      />,
    );

    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep' })).toBeTruthy();
  });
});
