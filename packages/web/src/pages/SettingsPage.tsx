import { SettingsAccountTab } from '../components/settings/SettingsAccountTab';
import { SettingsDrivesTab } from '../components/settings/SettingsDrivesTab';
import { SettingsS3Tab } from '../components/settings/SettingsS3Tab';

export function SettingsPage() {
  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-800">Settings</h1>
      <SettingsAccountTab />
      <SettingsDrivesTab />
      <SettingsS3Tab />
    </div>
  );
}
