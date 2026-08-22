// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { EditShareModal } from './EditShareModal';
import { sharedApi } from '../lib/api/shared';
import { useInvalidateSharedLinks } from '../hooks/useSharedLinks';
import type { SharedLink } from '../types';

vi.mock('../lib/api/shared', () => ({
  sharedApi: {
    updateSharedLink: vi.fn(),
  },
}));

vi.mock('../hooks/useSharedLinks', () => ({
  useInvalidateSharedLinks: vi.fn(),
}));

// Selector-aware toast mock: returns the picked value when a selector is passed,
// otherwise returns the full state object. EditShareModal destructures
// `{ addToast }` from `useToastStore()` (no selector), so the no-selector branch
// is exercised here.
const addToastMock = vi.fn();
vi.mock('../stores/useToastStore', () => ({
  useToastStore: (selector?: any) =>
    selector ? selector({ addToast: addToastMock }) : { addToast: addToastMock },
}));

vi.mock('lucide-react', () => ({
  Settings: (props: any) => <svg data-testid="settings-icon" {...props} />,
  ChevronDown: () => <svg data-testid="chevron-down-icon" />,
  ChevronUp: () => <svg data-testid="chevron-up-icon" />,
  Lock: () => <svg data-testid="lock-icon" />,
  Calendar: () => <svg data-testid="calendar-icon" />,
  Eye: () => <svg data-testid="eye-icon" />,
  EyeOff: () => <svg data-testid="eye-off-icon" />,
}));

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
      aria-label={props['aria-label']}
      title={props.title}
      {...props}
    >
      {loading && <span data-testid="button-spinner" />}
      {children}
    </button>
  ),
}));

// Input mock: passthrough <input> that exposes all standard HTML attributes
// (type, value, placeholder, min, autoComplete, className). We rely on real
// DOM queries (querySelector / getByPlaceholderText) for test assertions.
vi.mock('./ui/Input', () => ({
  Input: React.forwardRef<HTMLInputElement, any>(({ value, onChange, ...props }: any, ref) => (
    <input ref={ref} value={value ?? ''} onChange={onChange} {...props} />
  )),
}));

const baseLink: SharedLink = {
  id: 'link-1',
  userId: 'u-1',
  targetType: 'file',
  targetId: 'file-1',
  targetName: 'my-file.txt',
  targetMimeType: 'text/plain',
  expiresAt: '2099-12-31T23:59:59.000Z',
  viewCount: 5,
  downloadCount: 1,
  createdAt: '2024-01-01T00:00:00.000Z',
  allowDownloads: true,
  maxDownloads: null,
  webhookUrl: null,
};

// Helper: get the expiration datetime-local input. It has no placeholder, so
// we query by input[type="datetime-local"].
function getExpiryInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input[type="datetime-local"]');
  if (!el) throw new Error('datetime-local input not rendered');
  return el as HTMLInputElement;
}

describe('EditShareModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addToastMock.mockClear?.();
    (useInvalidateSharedLinks as Mock).mockReturnValue(vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders null when open=false (no dialog rendered)', () => {
    render(<EditShareModal open={false} link={baseLink} onClose={vi.fn()} />);

    expect(screen.queryByTestId('dialog')).toBeNull();
    expect(screen.queryByText('Edit Settings')).toBeNull();
  });

  it('renders the "Edit Settings" title and the password field placeholder', () => {
    render(<EditShareModal open link={baseLink} onClose={vi.fn()} />);

    expect(screen.getByText('Edit Settings')).toBeTruthy();
    // Password field placeholder identifies the field.
    expect(screen.getByPlaceholderText('Leave blank to keep current password')).toBeTruthy();
  });

  it('pre-fills the expiration input with the existing expiresAt (local datetime)', () => {
    const { container } = render(<EditShareModal open link={baseLink} onClose={vi.fn()} />);

    const expiryInput = getExpiryInput(container);
    // expiresAt is set on baseLink → input should be pre-filled (non-empty).
    expect(expiryInput.value).not.toBe('');
    // Empty default only when expiresAt is null — here expiresAt is set.
    expect(expiryInput.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('renders the "Allow downloads" checkbox checked when link.allowDownloads is true', () => {
    render(<EditShareModal open link={baseLink} onClose={vi.fn()} />);

    // Advanced section must be expanded first to see the checkbox.
    fireEvent.click(screen.getByText('Advanced'));
    const downloadsCheckbox = screen.getByLabelText('Allow downloads') as HTMLInputElement;
    expect(downloadsCheckbox.checked).toBe(true);
  });

  it('toggling the "Allow downloads" checkbox updates state and submits with new value', async () => {
    (sharedApi.updateSharedLink as Mock).mockResolvedValue(undefined);
    render(<EditShareModal open link={baseLink} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Advanced'));
    const downloadsCheckbox = screen.getByLabelText('Allow downloads') as HTMLInputElement;
    fireEvent.click(downloadsCheckbox);
    expect(downloadsCheckbox.checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(sharedApi.updateSharedLink).toHaveBeenCalledTimes(1);
    });
    const payload = (sharedApi.updateSharedLink as Mock).mock.calls[0][1];
    expect(payload.allowDownloads).toBe(false);
  });

  it('typing a new password into the password field submits it as the new password', async () => {
    (sharedApi.updateSharedLink as Mock).mockResolvedValue(undefined);
    render(<EditShareModal open link={baseLink} onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Leave blank to keep current password'), {
      target: { value: 'secret123' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(sharedApi.updateSharedLink).toHaveBeenCalledTimes(1);
    });
    const payload = (sharedApi.updateSharedLink as Mock).mock.calls[0][1];
    expect(payload.password).toBe('secret123');
  });

  it('leaves password blank in payload (null) when no password typed (keep current)', async () => {
    (sharedApi.updateSharedLink as Mock).mockResolvedValue(undefined);
    render(<EditShareModal open link={baseLink} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(sharedApi.updateSharedLink).toHaveBeenCalledTimes(1);
    });
    const payload = (sharedApi.updateSharedLink as Mock).mock.calls[0][1];
    expect(payload.password).toBeNull();
  });

  it('setting an expiration datetime submits an ISO-formatted expiresAt', async () => {
    (sharedApi.updateSharedLink as Mock).mockResolvedValue(undefined);
    const { container } = render(<EditShareModal open link={baseLink} onClose={vi.fn()} />);

    const expiryInput = getExpiryInput(container);
    fireEvent.change(expiryInput, { target: { value: '2099-12-31T23:59' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(sharedApi.updateSharedLink).toHaveBeenCalledTimes(1);
    });
    const payload = (sharedApi.updateSharedLink as Mock).mock.calls[0][1];
    // Source parses "YYYY-MM-DDThh:mm" via local-Date constructor → ISO format.
    expect(payload.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  it('submit calls sharedApi.updateSharedLink with the link id', async () => {
    (sharedApi.updateSharedLink as Mock).mockResolvedValue(undefined);
    render(<EditShareModal open link={baseLink} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(sharedApi.updateSharedLink).toHaveBeenCalledWith('link-1', expect.any(Object));
    });
  });

  it('on success: invalidates shared links, adds a success toast, and closes the modal', async () => {
    const invalidate = vi.fn();
    (useInvalidateSharedLinks as Mock).mockReturnValue(invalidate);
    (sharedApi.updateSharedLink as Mock).mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(<EditShareModal open link={baseLink} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledTimes(1);
    });
    // addToast('success', 'Shared link settings updated successfully')
    expect(addToastMock).toHaveBeenCalledWith(
      'success',
      'Shared link settings updated successfully',
    );
    // onClose called as part of the success path.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('on error: shows the error message inline and does NOT close the modal', async () => {
    (sharedApi.updateSharedLink as Mock).mockRejectedValue(new Error('Invalid expiration'));
    const onClose = vi.fn();

    render(<EditShareModal open link={baseLink} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(await screen.findByText('Invalid expiration')).toBeTruthy();
    // Modal stayed open
    expect(onClose).not.toHaveBeenCalled();
    // Save Settings button is still present (form is not collapsed)
    expect(screen.getByRole('button', { name: 'Save Settings' })).toBeTruthy();
  });

  it('on error (non-Error thrown): shows generic "Failed to update shared link"', async () => {
    (sharedApi.updateSharedLink as Mock).mockRejectedValue('surprise string');
    const onClose = vi.fn();

    render(<EditShareModal open link={baseLink} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(await screen.findByText('Failed to update shared link')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows loading state on the Save Settings button while submitting (never-resolving API)', async () => {
    (sharedApi.updateSharedLink as Mock).mockReturnValue(new Promise(() => {}));
    render(<EditShareModal open link={baseLink} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      // Save Settings button now has a spinner sibling.
      expect(screen.getByTestId('button-spinner')).toBeTruthy();
    });
    // Cancel button is also disabled while loading.
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
  });

  it('clicking Cancel calls onClose', () => {
    const onClose = vi.fn();
    render(<EditShareModal open link={baseLink} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('toggles password visibility (Eye/EyeOff) when the show-password button is clicked', () => {
    render(<EditShareModal open link={baseLink} onClose={vi.fn()} />);

    const passwordInput = screen.getByPlaceholderText(
      'Leave blank to keep current password',
    ) as HTMLInputElement;
    expect(passwordInput.getAttribute('type')).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(passwordInput.getAttribute('type')).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(passwordInput.getAttribute('type')).toBe('password');
  });

  it('clearing the expiration datetime submits expiresAt: null', async () => {
    (sharedApi.updateSharedLink as Mock).mockResolvedValue(undefined);
    const { container } = render(<EditShareModal open link={baseLink} onClose={vi.fn()} />);

    const expiryInput = getExpiryInput(container);
    fireEvent.change(expiryInput, { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(sharedApi.updateSharedLink).toHaveBeenCalledTimes(1);
    });
    const payload = (sharedApi.updateSharedLink as Mock).mock.calls[0][1];
    expect(payload.expiresAt).toBeNull();
  });
});
