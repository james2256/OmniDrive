// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { RenameDialog } from './RenameDialog';

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
  DialogBody: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
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

vi.mock('./ui/Input', () => ({
  Input: React.forwardRef<HTMLInputElement, any>(({ value, onChange, ...props }: any, ref) => (
    <input ref={ref} value={value} onChange={onChange} data-testid="rename-input" {...props} />
  )),
}));

vi.mock('lucide-react', () => ({
  Pen: () => <svg data-testid="pen-icon" />,
}));

describe('RenameDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders null when open=false', () => {
    render(
      <RenameDialog
        open={false}
        initialName="old.txt"
        title="Rename File"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('dialog')).toBeNull();
    expect(screen.queryByText('Rename File')).toBeNull();
  });

  it('renders the title and pre-fills the input with initialName when open', () => {
    render(
      <RenameDialog
        open
        initialName="my-file.txt"
        title="Rename File"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Rename File')).toBeTruthy();
    expect(screen.getByTestId('rename-input')).toBeTruthy();
    expect((screen.getByTestId('rename-input') as HTMLInputElement).value).toBe('my-file.txt');
  });

  it('Rename button is disabled when the name equals initialName (no change)', () => {
    render(
      <RenameDialog
        open
        initialName="same.txt"
        title="Rename File"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Rename' }).hasAttribute('disabled')).toBe(true);
  });

  it('Rename button is disabled when the name is empty or whitespace-only', () => {
    render(
      <RenameDialog
        open
        initialName="old.txt"
        title="Rename File"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByTestId('rename-input');
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Rename' }).hasAttribute('disabled')).toBe(true);

    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Rename' }).hasAttribute('disabled')).toBe(true);
  });

  it('submitting the form calls onConfirm with the trimmed new name', () => {
    const onConfirm = vi.fn();
    render(
      <RenameDialog
        open
        initialName="old.txt"
        title="Rename File"
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('rename-input'), {
      target: { value: '  new-name.txt  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('new-name.txt');
  });

  it('submit does NOT call onConfirm when the name is unchanged (=== initialName)', () => {
    const onConfirm = vi.fn();
    render(
      <RenameDialog
        open
        initialName="same.txt"
        title="Rename File"
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    // The Rename button is disabled, so clicking won't fire onClick — but submit
    // would not call onConfirm either since name === initialName short-circuits.
    const form = screen.getByTestId('rename-input').closest('form') as HTMLFormElement | null;
    expect(form).toBeTruthy();
    fireEvent.submit(form!);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('clicking the Cancel button calls onClose', () => {
    const onClose = vi.fn();
    render(
      <RenameDialog
        open
        initialName="old.txt"
        title="Rename File"
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the dialog backdrop (onOpenChange(false)) calls onClose when not loading', () => {
    const onClose = vi.fn();
    render(
      <RenameDialog
        open
        initialName="old.txt"
        title="Rename File"
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons and shows a spinner when loading=true', () => {
    render(
      <RenameDialog
        open
        initialName="old.txt"
        title="Rename File"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        loading
      />,
    );

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    // The Rename button's text is still "Rename" but it's disabled via loading.
    const rename = screen
      .getAllByRole('button')
      .find((b) => b.textContent === 'Rename' || b.textContent?.includes('Rename'));
    expect(rename).toBeTruthy();
    expect(cancel.hasAttribute('disabled')).toBe(true);
    expect(rename!.hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('button-spinner')).toBeTruthy();
  });

  it('does NOT call onClose from onOpenChange(false) while loading', () => {
    const onClose = vi.fn();
    render(
      <RenameDialog
        open
        initialName="old.txt"
        title="Rename File"
        onConfirm={vi.fn()}
        onClose={onClose}
        loading
      />,
    );

    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
