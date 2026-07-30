import { PageHeader } from '../components/layout/PageHeader';
import { Settings } from 'lucide-react';
import { SettingsAccountTab } from '../components/settings/SettingsAccountTab';
import { SettingsDrivesTab } from '../components/settings/SettingsDrivesTab';
import { SettingsS3Tab } from '../components/settings/SettingsS3Tab';

export function SettingsPage() {
  return (
    <div className="p-2 sm:p-6 space-y-2">
      <PageHeader
        title="Settings"
        icon={Settings}
        description="Manage your account, drives, and S3 credentials"
      />
      <SettingsAccountTab />
      <SettingsDrivesTab />
      <SettingsS3Tab />
    </div>
  );
}
