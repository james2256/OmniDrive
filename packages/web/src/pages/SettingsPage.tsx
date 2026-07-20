import { useCallback, useEffect, useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDrives, useRemoveDrive, useTriggerSync } from '../hooks/useDrives';
import { qk } from '../lib/queryKeys';
import { DriveAccountCard } from '../components/DriveAccountCard';
import type { S3Credential } from '../lib/api';
import { useToastStore } from '../stores/toastStore';
import { Plus, Key, X, Trash2, Copy, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { api } from '../lib/api';

const parseSqliteDate = (dateVal: string | number) => {
  if (!dateVal) return new Date();
  if (typeof dateVal === 'string') {
    const normalized = dateVal.includes(' ') && !dateVal.includes('T')
      ? dateVal.replace(' ', 'T') + 'Z'
      : dateVal;
    return new Date(normalized);
  }
  return new Date(dateVal);
};

export function SettingsPage() {
  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const removeDriveMutation = useRemoveDrive();
  const triggerSyncMutation = useTriggerSync();
  const queryClient = useQueryClient();
  const { addToast } = useToastStore();
  const [showSaForm, setShowSaForm] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [saCredentials, setSaCredentials] = useState('');
  const [saFolderId, setSaFolderId] = useState('');

  const [s3Keys, setS3Keys] = useState<S3Credential[]>([]);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string; role: string }[]>([]);
  const [loadingS3, setLoadingS3] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const handleConnectDrive = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    try {
      const { url } = await api.getDriveConnectUrl();
      window.location.href = url;
    } catch (e) {
      setIsConnecting(false);
      addToast('error', e instanceof Error ? e.message : 'Failed to start Google OAuth');
    }
  };

  // Form states for creating a key
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyDescription, setNewKeyDescription] = useState('');
  const [newKeyScope, setNewKeyScope] = useState(''); // Empty string means Global
  const [isCreatingKey, setIsCreatingKey] = useState(false);

  // Form states for showing the created credentials
  const [createdCredential, setCreatedCredential] = useState<{
    accessKeyId: string;
    secretAccessKey: string;
    description: string;
  } | null>(null);
  const [copiedAccessKey, setCopiedAccessKey] = useState(false);
  const [copiedSecretKey, setCopiedSecretKey] = useState(false);

  const loadData = useCallback(async () => {
    setLoadingS3(true);
    try {
      const [keys, wsData] = await Promise.all([
        api.getS3Credentials(),
        api.getWorkspaces()
      ]);
      setS3Keys(keys);
      // Filter the list of workspaces to only contain items where role === 'manager' || role === 'owner'
      const filtered = (wsData.workspaces || []).filter(
        (w: { id: string; name: string; role: string }) => w.role === 'manager' || w.role === 'owner'
      );
      setWorkspaces(filtered);
    } catch {
      addToast('error', 'Failed to load S3 key data');
    } finally {
      setLoadingS3(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyDescription.trim()) return;

    setIsCreatingKey(true);
    try {
      const result = await api.createS3Credential(
        newKeyDescription,
        newKeyScope || undefined
      );

      // Store the returned credentials to display in the success modal/view
      setCreatedCredential({
        accessKeyId: result.accessKeyId,
        secretAccessKey: result.secretAccessKey,
        description: result.description,
      });

      // Clear form
      setNewKeyDescription('');
      setNewKeyScope('');
      setShowCreateModal(false);

      // Refresh list
      loadData();
      addToast('success', 'S3 API key created successfully');
    } catch {
      addToast('error', 'Failed to create S3 API key');
    } finally {
      setIsCreatingKey(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this S3 API key? This action is permanent and any application using this key will lose access.')) {
      return;
    }
    try {
      await api.deleteS3Credential(id);
      addToast('success', 'S3 key revoked successfully');
      // Refresh list
      loadData();
    } catch {
      addToast('error', 'Failed to revoke S3 key');
    }
  };

  const handleCopy = (text: string, type: 'access' | 'secret') => {
    navigator.clipboard.writeText(text);
    if (type === 'access') {
      setCopiedAccessKey(true);
      setTimeout(() => setCopiedAccessKey(false), 2000);
    } else {
      setCopiedSecretKey(true);
      setTimeout(() => setCopiedSecretKey(false), 2000);
    }
  };

  useEffect(() => {
    const hasSyncing = drives.some(d => d.syncStatus === 'syncing');
    if (!hasSyncing) return;

    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: qk.drives });
    }, 3000);

    return () => clearInterval(interval);
  }, [drives, queryClient]);

  const handleSync = async (id: string) => {
    try {
      addToast('info', 'Syncing... large drives may take multiple cycles');
      let cycles = 0;
      const maxCycles = 50;

      const runSyncCycle = async (): Promise<void> => {
        await triggerSyncMutation.mutateAsync(id);
        cycles++;
        await new Promise((r) => setTimeout(r, 3000));
        await queryClient.invalidateQueries({ queryKey: qk.drives });
        const drivesData = queryClient.getQueryData<{ drives: typeof drives }>(qk.drives);
        const drive = drivesData?.drives.find((d) => d.id === id);

        if (drive?.syncPaused && cycles < maxCycles) {
          return runSyncCycle();
        }
      };

      await runSyncCycle();
      addToast('success', `Sync completed (${cycles} cycle${cycles > 1 ? 's' : ''})`);
    } catch {
      addToast('error', 'Sync failed');
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await removeDriveMutation.mutateAsync(id);
    } catch {
      // error toast handled by mutation's onError
    }
  };

  const handleAddServiceAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.addServiceAccount(saCredentials, saFolderId);
      addToast('success', 'Service account added');
      setSaCredentials('');
      setSaFolderId('');
      setShowSaForm(false);
      queryClient.invalidateQueries({ queryKey: qk.drives });
    } catch {
      addToast('error', 'Failed to add service account');
    }
  };

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
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold text-stone-800">Settings</h1>

      {/* Section: Account password */}
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

      {/* Section: Connected Drives */}
      <div>
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">Connected Drives</h2>
        <div className="space-y-3">
          {drives.map((drive, i) => (
            <DriveAccountCard
              key={drive.id}
              drive={drive}
              index={i}
              onSync={handleSync}
              onDisconnect={handleDisconnect}
            />
          ))}
          {drives.length === 0 && (
            <div className="text-center py-8 text-stone-400 border border-dashed border-stone-200 rounded-xl">
              No drives connected yet
            </div>
          )}
        </div>
      </div>

      {/* Section: Add Drive */}
      <div>
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">Add Drive</h2>
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={handleConnectDrive}
            disabled={isConnecting}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium text-sm disabled:opacity-60"
          >
            {isConnecting ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />} Add Google Drive
          </button>
          <button
            className="flex items-center gap-2 px-4 py-2.5 bg-card text-stone-700 rounded-xl border border-stone-300 hover:bg-stone-50 transition-colors font-medium text-sm"
            onClick={() => setShowSaForm(!showSaForm)}
          >
            <Key size={18} /> Add Service Account
          </button>
        </div>
      </div>

      {/* Service Account Form */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${showSaForm ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="bg-card border border-stone-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-stone-800">Add Service Account</h3>
            <button
              onClick={() => setShowSaForm(false)}
              className="p-1.5 hover:bg-stone-100 rounded-full text-stone-500 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          <form onSubmit={handleAddServiceAccount} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">
                Service Account JSON
              </label>
              <textarea
                value={saCredentials}
                onChange={(e) => setSaCredentials(e.target.value)}
                placeholder="Paste service account JSON key..."
                rows={6}
                className="w-full font-mono text-xs border border-stone-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">
                Shared Folder ID
              </label>
              <input
                type="text"
                value={saFolderId}
                onChange={(e) => setSaFolderId(e.target.value)}
                placeholder="Google Drive folder ID shared with SA"
                className="w-full border border-stone-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-stone-700 bg-card border border-stone-300 rounded-xl hover:bg-stone-50 transition-colors"
                onClick={() => setShowSaForm(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
              >
                Add Account
              </button>
            </div>
          </form>
          </div>
        </div>
      </div>

      {/* Section: S3 API Keys */}
      <div className="border-t border-stone-200 pt-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">S3 API Keys</h2>
            <p className="text-xs text-stone-400 mt-1">Manage workspace-scoped and global S3-compatible credentials for accessing object storage.</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors font-medium text-xs shadow-sm"
          >
            <Plus size={16} /> Generate New Key
          </button>
        </div>

        {loadingS3 ? (
          <div className="flex items-center justify-center py-8 text-stone-400">
            <Loader2 className="animate-spin mr-2" size={18} />
            Loading S3 credentials...
          </div>
        ) : s3Keys.length === 0 ? (
          <div className="text-center py-8 text-stone-400 border border-dashed border-stone-200 rounded-xl">
            No S3 API keys generated yet.
          </div>
        ) : (
          <div className="bg-card border border-stone-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200">
                    <th className="px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">Description</th>
                    <th className="px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">Access Key ID</th>
                    <th className="px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">Scope</th>
                    <th className="px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">Created At</th>
                    <th className="px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-150">
                  {s3Keys.map((key: S3Credential) => (
                    <tr key={key.id} className="hover:bg-stone-50/50 transition-colors">
                      <td className="px-4 py-3.5 text-sm text-stone-800 font-medium">
                        {key.description || <span className="text-stone-400 italic">No description</span>}
                      </td>
                      <td className="px-4 py-3.5 text-xs font-mono text-stone-600 bg-stone-50/50 rounded select-all font-semibold">
                        {key.access_key_id || key.accessKeyId}
                      </td>
                      <td className="px-4 py-3.5 text-sm">
                        {key.workspace_id || key.workspaceId ? (
                          <span className="px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-150">
                            Workspace: {key.workspace_name || key.workspaceName || 'Unknown'}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-50 text-green-700 border border-green-150">
                            Global
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-stone-400">
                        {parseSqliteDate(key.created_at || key.createdAt || '').toLocaleString()}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <button
                          onClick={() => handleRevokeKey(key.id)}
                          className="p-1 text-stone-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                          title="Revoke Key"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Create S3 Key Dialog */}
      <Dialog open={showCreateModal} onOpenChange={(open) => !open && !isCreatingKey && setShowCreateModal(false)}>
        <DialogContent className="sm:max-w-[425px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-stone-800">Generate S3 API Key</DialogTitle>
            <DialogDescription className="text-xs text-stone-400">
              Create credentials to access OmniDrive storage with S3 compatible applications.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateKey} className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
                Description
              </label>
              <input
                type="text"
                value={newKeyDescription}
                onChange={(e) => setNewKeyDescription(e.target.value)}
                placeholder="e.g. Rclone desktop client, backup script"
                className="w-full border border-stone-300 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
                maxLength={100}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
                Scope
              </label>
              <select
                value={newKeyScope}
                onChange={(e) => setNewKeyScope(e.target.value)}
                className="w-full border border-stone-300 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-card"
              >
                <option value="">Global (All Workspaces)</option>
                {workspaces.map((w: { id: string; name: string; role: string }) => (
                  <option key={w.id} value={w.id}>
                    Workspace: {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 justify-end pt-4">
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-stone-700 bg-card border border-stone-300 rounded-xl hover:bg-stone-50 transition-colors"
                onClick={() => setShowCreateModal(false)}
                disabled={isCreatingKey}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
                disabled={isCreatingKey || !newKeyDescription.trim()}
              >
                {isCreatingKey && <Loader2 className="animate-spin" size={16} />}
                Generate Key
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Success Modal - Credentials Display */}
      <Dialog open={createdCredential !== null} onOpenChange={(open) => !open && setCreatedCredential(null)}>
        <DialogContent
          className="sm:max-w-[480px] rounded-2xl"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-stone-800 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block animate-ping" />
              S3 Key Created Successfully
            </DialogTitle>
            <DialogDescription className="text-xs text-stone-400">
              Save these credentials. For security, the secret key will never be shown again.
            </DialogDescription>
          </DialogHeader>

          {createdCredential && (
            <div className="space-y-4 pt-3">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-3">
                <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={18} />
                <div className="text-xs text-amber-800">
                  <span className="font-semibold block mb-0.5">Security Warning:</span>
                  Please copy the Secret Access Key below now. You will not be able to retrieve or view it again once this modal is closed.
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
                  Description
                </label>
                <div className="text-sm font-medium text-stone-800 bg-stone-50 border border-stone-150 rounded-xl px-3 py-2">
                  {createdCredential.description || <span className="text-stone-400 italic">No description</span>}
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider">
                    Access Key ID
                  </label>
                  <button
                    onClick={() => handleCopy(createdCredential.accessKeyId, 'access')}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    {copiedAccessKey ? (
                      <>
                        <Check size={14} />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy size={14} />
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <div className="font-mono text-xs text-stone-700 bg-stone-50 border border-stone-150 rounded-xl px-3 py-2.5 break-all select-all">
                  {createdCredential.accessKeyId}
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider">
                    Secret Access Key
                  </label>
                  <button
                    onClick={() => handleCopy(createdCredential.secretAccessKey, 'secret')}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    {copiedSecretKey ? (
                      <>
                        <Check size={14} />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy size={14} />
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <div className="font-mono text-xs text-stone-700 bg-stone-50 border border-stone-150 rounded-xl px-3 py-2.5 break-all select-all">
                  {createdCredential.secretAccessKey}
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-stone-100">
                <button
                  type="button"
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                  onClick={() => setCreatedCredential(null)}
                >
                  I've Copied the Secret Key
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
