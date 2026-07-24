import { AccountPasswordForm } from './AccountPasswordForm';

export function SettingsAccountTab() {
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Account</h2>
      <AccountPasswordForm />
    </div>
  );
}
