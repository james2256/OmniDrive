import { useCallback, useEffect, useState } from 'react';
import type { S3Credential } from '../../lib/api';
import { useToastStore } from '../../stores/useToastStore';
import { Plus, Trash2, Copy, Check, TriangleAlert, KeyRound, CheckCircle2, LoaderCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ConfirmDialog } from '../ConfirmDialog';
import { api } from '../../lib/api';
import { formatAbsoluteDate } from '../../lib/utils';

export function SettingsS3Tab() {
  const { addToast } = useToastStore();
  const [s3Keys, setS3Keys] = useState<S3Credential[]>([]);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string; role: string }[]>([]);
  const [loadingS3, setLoadingS3] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyDescription, setNewKeyDescription] = useState('');
  const [newKeyScope, setNewKeyScope] = useState(''); // Empty string means Global
  const [isCreatingKey, setIsCreatingKey] = useState(false);

  const [createdCredential, setCreatedCredential] = useState<{
    accessKeyId: string;
    secretAccessKey: string;
    description: string;
  } | null>(null);
  const [copiedAccessKey, setCopiedAccessKey] = useState(false);
  const [copiedSecretKey, setCopiedSecretKey] = useState(false);

  // Revoke-key confirmation dialog state
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

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

      setCreatedCredential({
        accessKeyId: result.accessKeyId,
        secretAccessKey: result.secretAccessKey,
        description: result.description,
      });

      setNewKeyDescription('');
      setNewKeyScope('');
      setShowCreateModal(false);

      loadData();
      addToast('success', 'S3 API key created successfully');
    } catch {
      addToast('error', 'Failed to create S3 API key');
    } finally {
      setIsCreatingKey(false);
    }
  };

  const handleRevokeKey = (id: string) => {
    setRevokeTargetId(id);
  };

  const confirmRevokeKey = async () => {
    if (!revokeTargetId) return;
    setIsRevoking(true);
    try {
      await api.deleteS3Credential(revokeTargetId);
      addToast('success', 'S3 key revoked successfully');
      setRevokeTargetId(null);
      loadData();
    } catch {
      addToast('error', 'Failed to revoke S3 key');
    } finally {
      setIsRevoking(false);
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

  return (
    <>
      {/* Section: S3 API Keys */}
      <div className="border-t border-slate-200 pt-6">
        <div className="flex justify-between items-center mb-4 gap-2 sm:gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">S3 API Keys</h2>
            <p className="text-xs text-slate-500 mt-1">Manage workspace-scoped and global S3-compatible credentials for accessing object storage.</p>
          </div>
          <Button
            onClick={() => setShowCreateModal(true)}
            variant="primary"
            className="px-3 py-2 rounded-lg sm:rounded-xl text-xs flex-shrink-0"
          >
            <Plus size={16} /> Generate New Key
          </Button>
        </div>

        {loadingS3 ? (
          <div className="flex items-center justify-center py-8 text-slate-500">
            <LoaderCircle className="animate-spin mr-2" size={18} />
            Loading S3 credentials...
          </div>
        ) : s3Keys.length === 0 ? (
          <div className="text-center py-8 text-slate-500 border border-dashed border-slate-200 rounded-xl">
            No S3 API keys generated yet.
          </div>
        ) : (
          <div className="bg-card border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Description</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Access Key ID</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Scope</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Created At</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {s3Keys.map((key: S3Credential) => (
                    <tr key={key.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3.5 text-sm text-slate-800 font-medium">
                        {key.description || <span className="text-slate-500 italic">No description</span>}
                      </td>
                      <td className="px-4 py-3.5 text-xs font-mono text-slate-600 bg-slate-50/50 rounded select-all font-semibold">
                        {key.accessKeyId}
                      </td>
                      <td className="px-4 py-3.5 text-sm">
                        {key.workspaceId ? (
                          <span className="px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full bg-primary/10 text-blue-700 border border-blue-150">
                            Workspace: {key.workspaceName || 'Unknown'}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-50 text-green-700 border border-green-150">
                            Global
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-500">
                        {formatAbsoluteDate(key.createdAt)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Button
                          onClick={() => handleRevokeKey(key.id)}
                          variant="ghostDanger"
                          className="p-1 text-slate-500 rounded-lg"
                          title="Revoke Key"
                        >
                          <Trash2 size={16} />
                        </Button>
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
        <DialogContent className="max-w-md p-0 gap-0 flex flex-col overflow-hidden">
          <DialogHeader icon={<KeyRound size={20} className="text-primary" />}>
            <DialogTitle>Generate S3 API Key</DialogTitle>
            <DialogDescription className="text-xs text-slate-500 mt-1">
              Create credentials to access OmniDrive storage with S3 compatible applications.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateKey} className="flex flex-col flex-1 min-h-0">
            <DialogBody>
              <div className="space-y-2.5">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">Description</label>
                  <Input
                    type="text"
                    value={newKeyDescription}
                    onChange={(e) => setNewKeyDescription(e.target.value)}
                    placeholder="e.g. Rclone desktop client"
                    required
                    maxLength={100}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">Scope</label>
                  <select
                    value={newKeyScope}
                    onChange={(e) => setNewKeyScope(e.target.value)}
                    className="w-full px-3 py-1.5 bg-card border border-slate-400 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-shadow"
                  >
                    <option value="">Global (All Workspaces)</option>
                    {workspaces.map((w: { id: string; name: string; role: string }) => (
                      <option key={w.id} value={w.id}>
                        Workspace: {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" type="button" onClick={() => setShowCreateModal(false)} disabled={isCreatingKey}>Cancel</Button>
              <Button type="submit" loading={isCreatingKey} disabled={isCreatingKey || !newKeyDescription.trim()}>Generate Key</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Success Modal - Credentials Display */}
      <Dialog open={createdCredential !== null} onOpenChange={(open) => !open && setCreatedCredential(null)}>
        <DialogContent
          className="sm:max-w-[460px] p-0 gap-0 flex flex-col overflow-hidden"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader icon={<CheckCircle2 size={20} className="text-green-500" />}>
            <DialogTitle>S3 Key Created</DialogTitle>
            <DialogDescription className="text-xs text-slate-500 mt-1">
              Save these credentials. The secret key will never be shown again.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            {createdCredential && (
              <div className="space-y-2.5">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-3">
                  <TriangleAlert className="text-amber-600 flex-shrink-0 mt-0.5" size={18} />
                  <div className="text-xs text-amber-800">
                    <span className="font-semibold block mb-0.5">Security Warning:</span>
                    Please copy the Secret Access Key below now. You will not be able to retrieve or view it again once this modal is closed.
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Description
                  </label>
                  <div className="text-sm font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                    {createdCredential.description || <span className="text-slate-500 italic">No description</span>}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Access Key ID
                    </label>
                    <Button
                      onClick={() => handleCopy(createdCredential.accessKeyId, 'access')}
                      variant="ghost"
                      className="gap-1 text-xs text-primary hover:text-blue-700 hover:bg-transparent px-0 py-0 rounded-none"
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
                    </Button>
                  </div>
                  <div className="font-mono text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 break-all select-all">
                    {createdCredential.accessKeyId}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Secret Access Key
                    </label>
                    <Button
                      onClick={() => handleCopy(createdCredential.secretAccessKey, 'secret')}
                      variant="ghost"
                      className="gap-1 text-xs text-primary hover:text-blue-700 hover:bg-transparent px-0 py-0 rounded-none"
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
                    </Button>
                  </div>
                  <div className="font-mono text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 break-all select-all">
                    {createdCredential.secretAccessKey}
                  </div>
                </div>
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setCreatedCredential(null)}>I've Copied the Secret Key</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revokeTargetId !== null}
        title="Revoke S3 API Key"
        message="Are you sure you want to revoke this S3 API key? This action is permanent and any application using this key will lose access."
        confirmText="Revoke Key"
        cancelText="Cancel"
        variant="danger"
        loading={isRevoking}
        onConfirm={confirmRevokeKey}
        onClose={() => !isRevoking && setRevokeTargetId(null)}
      />
    </>
  );
}
