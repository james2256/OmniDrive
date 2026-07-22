// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SettingsAccountTab } from './SettingsAccountTab';
import { api } from '../../lib/api';
import { useToastStore } from '../../stores/useToastStore';

vi.mock('../../lib/api', () => ({
  api: {
    changePassword: vi.fn(),
  },
}));

vi.mock('../../stores/useToastStore', () => ({
  useToastStore: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  Key: () => <svg data-testid="key-icon" />,
  LoaderCircle: () => <svg data-testid="loader-icon" className="animate-spin" />,
}));

describe('SettingsAccountTab', () => {
  const addToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useToastStore as unknown as Mock).mockReturnValue({ addToast });
  });

  afterEach(() => cleanup());

  it('shows error toast when new password and confirmation do not match', async () => {
    render(<SettingsAccountTab />);

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'OldPass1!' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'Different1!' } });

    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    expect(addToast).toHaveBeenCalledWith('error', 'New password and confirmation do not match');
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it('submits to API and shows success toast when passwords match', async () => {
    (api.changePassword as Mock).mockResolvedValue({ success: true });

    render(<SettingsAccountTab />);

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'OldPass1!' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPass1!' } });

    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(api.changePassword).toHaveBeenCalledWith('OldPass1!', 'NewPass1!');
    });

    expect(addToast).toHaveBeenCalledWith('success', 'Password updated. Other sessions were signed out.');

    // Fields cleared after success
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Confirm new password') as HTMLInputElement).value).toBe('');
  });

  it('shows error toast when API call fails', async () => {
    (api.changePassword as Mock).mockRejectedValue(new Error('Current password is incorrect'));

    render(<SettingsAccountTab />);

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'WrongPass1!' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPass1!' } });

    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('error', 'Current password is incorrect');
    });
  });
});
