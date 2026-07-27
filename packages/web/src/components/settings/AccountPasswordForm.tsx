import { useState } from 'react';
import { Key } from 'lucide-react';
import { useToastStore } from '../../stores/useToastStore';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';

/** Change-password form for the Settings → Account tab. */
export function AccountPasswordForm() {
  const { addToast } = useToastStore();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      addToast('error', 'New password and confirmation do not match');
      return;
    }
    setIsChangingPassword(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      addToast('success', 'Password updated. Other sessions were signed out.');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <form onSubmit={handleChangePassword} className="bg-card border border-slate-200 rounded-2xl p-5 space-y-4 max-w-md">
      <p className="text-sm text-slate-600">Change your login password. Other devices will be signed out.</p>
      <div>
        <label htmlFor="current-password" className="block text-sm font-medium text-slate-700 mb-1.5">
          Current password
        </label>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="w-full border border-slate-400 rounded-xl p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary bg-card"
        />
      </div>
      <div>
        <label htmlFor="new-password" className="block text-sm font-medium text-slate-700 mb-1.5">
          New password
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full border border-slate-400 rounded-xl p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary bg-card"
        />
        <p className="mt-1 text-xs text-slate-500">Min 8 chars, with upper, lower, and a number.</p>
      </div>
      <div>
        <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700 mb-1.5">
          Confirm new password
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full border border-slate-400 rounded-xl p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary bg-card"
        />
      </div>
      <div className="flex justify-end pt-1">
        <Button
          type="submit"
          variant="primary"
          className="rounded-xl disabled:opacity-60"
          disabled={isChangingPassword}
          loading={isChangingPassword}
        >
          {!isChangingPassword && <Key size={16} />}
          Change password
        </Button>
      </div>
    </form>
  );
}
