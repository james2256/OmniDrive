import { useState } from 'react';
import { Key, Loader2 } from 'lucide-react';
import { useToastStore } from '../../stores/useToastStore';
import { api } from '../../lib/api';

export function SettingsAccountTab() {
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
    <div>
      <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">Account</h2>
      <form onSubmit={handleChangePassword} className="bg-card border border-stone-200 rounded-2xl p-5 space-y-4 max-w-md">
        <p className="text-sm text-stone-600">Change your login password. Other devices will be signed out.</p>
        <div>
          <label htmlFor="current-password" className="block text-sm font-medium text-stone-700 mb-1.5">
            Current password
          </label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full border border-stone-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-card"
          />
        </div>
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium text-stone-700 mb-1.5">
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
            className="w-full border border-stone-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-card"
          />
          <p className="mt-1 text-xs text-stone-500">Min 8 chars, with upper, lower, and a number.</p>
        </div>
        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-stone-700 mb-1.5">
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
            className="w-full border border-stone-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-card"
          />
        </div>
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={isChangingPassword}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-60"
          >
            {isChangingPassword ? <Loader2 size={16} className="animate-spin" /> : <Key size={16} />}
            Change password
          </button>
        </div>
      </form>
    </div>
  );
}
