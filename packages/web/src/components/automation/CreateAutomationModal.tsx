import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, Zap } from 'lucide-react';
import { useCreateAutomation, useUpdateAutomation } from '../../hooks/useAutomations';
import { foldersApi } from '../../lib/api/folders';
import { qk } from '../../lib/queryKeys';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { AutomationRule, RuleCondition, RuleAction } from '../../types';

interface CreateAutomationModalProps {
  open: boolean;
  /** null = create mode; AutomationRule = edit mode (form pre-filled). */
  editingRule: AutomationRule | null;
  onClose: () => void;
}

const EMPTY_CONDITION: RuleCondition = { field: 'extension', operator: 'endswith', value: '' };
const EMPTY_ACTION: RuleAction = { type: 'move', targetFolderId: '' };

/**
 * Create or edit an automation rule. Supports dynamic conditions + actions
 * arrays. The move-target picker shows workspace folders only — the engine's
 * `findMembership` check rejects Google Drive folder IDs (verified in
 * automation.service.ts).
 *
 * triggerConfig is not exposed as a functional field — the engine never reads
 * it (grep returns 0 hits in automation.service.ts). It's stored as `{}` for
 * both trigger types.
 */
export function CreateAutomationModal({ open, editingRule, onClose }: CreateAutomationModalProps) {
  const createMutation = useCreateAutomation();
  const updateMutation = useUpdateAutomation();

  // Fetch workspace folders for the move-target picker. Same pattern as
  // WorkspacesPage.tsx:47-48 (inline useQuery, no dedicated hook).
  const { data: workspaceFolders } = useQuery({
    queryKey: qk.workspaceTree,
    queryFn: () => foldersApi.getWorkspaceTree(),
    enabled: open,
  });

  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<'event' | 'cron'>('event');
  const [conditions, setConditions] = useState<RuleCondition[]>([EMPTY_CONDITION]);
  const [actions, setActions] = useState<RuleAction[]>([EMPTY_ACTION]);
  const [error, setError] = useState('');

  // Reset / pre-fill form each time the modal opens.
  useEffect(() => {
    if (!open) return;
    if (editingRule) {
      setName(editingRule.name);
      setTriggerType(editingRule.triggerType);
      setConditions(editingRule.conditions.length > 0 ? editingRule.conditions : [EMPTY_CONDITION]);
      setActions(editingRule.actions.length > 0 ? editingRule.actions : [EMPTY_ACTION]);
    } else {
      setName('');
      setTriggerType('event');
      setConditions([EMPTY_CONDITION]);
      setActions([EMPTY_ACTION]);
    }
    setError('');
  }, [open, editingRule]);

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Rule name is required');
      return;
    }
    // Filter out empty conditions/actions (no value / no target).
    const cleanConditions = conditions.filter((c) => c.value.trim() !== '');
    const cleanActions = actions.filter(
      (a) => a.type === 'delete' || (a.type === 'move' && a.targetFolderId),
    );

    const body = {
      name: trimmedName,
      triggerType,
      triggerConfig: {},
      conditions: cleanConditions,
      actions: cleanActions,
    };

    try {
      if (editingRule) {
        await updateMutation.mutateAsync({ id: editingRule.id, body });
      } else {
        await createMutation.mutateAsync(body);
      }
      onClose();
    } catch {
      // toast handled by hook's onError
    }
  };

  const updateCondition = (i: number, patch: Partial<RuleCondition>) => {
    setConditions((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };
  const updateAction = (i: number, patch: Partial<RuleAction>) => {
    setActions((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isPending && onClose()}>
      <DialogContent className="max-w-lg p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader icon={<Zap size={20} className="text-primary" />}>
          <DialogTitle>
            {editingRule ? 'Edit Automation Rule' : 'Create Automation Rule'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <DialogBody className="space-y-4">
            {error && (
              <div className="text-red-500 text-sm bg-red-50 p-2 rounded-lg border border-red-100">
                {error}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Name</label>
              <Input
                type="text"
                autoFocus
                placeholder="e.g. Auto-archive PDFs"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Trigger</label>
              <select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as 'event' | 'cron')}
                className="w-full px-3 py-1.5 bg-card border border-slate-400 rounded-xl text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <option value="event">On file upload (event)</option>
                <option value="cron">Periodic sweep (cron, every 30 min)</option>
              </select>
            </div>

            {/* Conditions */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-600">When file matches:</label>
              {conditions.map((cond, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <select
                    value={cond.field}
                    onChange={(e) =>
                      updateCondition(i, { field: e.target.value as RuleCondition['field'] })
                    }
                    className="px-2 py-1.5 bg-card border border-slate-400 rounded-lg text-sm flex-shrink-0"
                  >
                    <option value="name">Filename</option>
                    <option value="extension">Extension</option>
                  </select>
                  <select
                    value={cond.operator}
                    onChange={(e) =>
                      updateCondition(i, { operator: e.target.value as RuleCondition['operator'] })
                    }
                    className="px-2 py-1.5 bg-card border border-slate-400 rounded-lg text-sm flex-shrink-0"
                  >
                    <option value="endswith">ends with</option>
                    <option value="contains">contains</option>
                    <option value="equals">equals</option>
                  </select>
                  <Input
                    type="text"
                    placeholder="value (e.g. .pdf)"
                    value={cond.value}
                    onChange={(e) => updateCondition(i, { value: e.target.value })}
                    className="flex-1"
                  />
                  {conditions.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="p-1.5 text-red-600 flex-shrink-0"
                      aria-label="Remove condition"
                      onClick={() => setConditions((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                className="self-start text-xs gap-1"
                onClick={() => setConditions((prev) => [...prev, EMPTY_CONDITION])}
              >
                <Plus size={12} /> Add condition
              </Button>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-600">Then:</label>
              {actions.map((action, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <select
                    value={action.type}
                    onChange={(e) => {
                      const type = e.target.value as RuleAction['type'];
                      updateAction(i, { type, targetFolderId: type === 'move' ? '' : undefined });
                    }}
                    className="px-2 py-1.5 bg-card border border-slate-400 rounded-lg text-sm flex-shrink-0"
                  >
                    <option value="move">Move to folder</option>
                    <option value="delete">Delete (trash)</option>
                  </select>
                  {action.type === 'move' && (
                    <select
                      value={action.targetFolderId ?? ''}
                      onChange={(e) => updateAction(i, { targetFolderId: e.target.value })}
                      className="flex-1 px-2 py-1.5 bg-card border border-slate-400 rounded-lg text-sm"
                    >
                      <option value="">Select workspace folder…</option>
                      {(workspaceFolders?.folders ?? []).map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {actions.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="p-1.5 text-red-600 flex-shrink-0"
                      aria-label="Remove action"
                      onClick={() => setActions((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                className="self-start text-xs gap-1"
                onClick={() => setActions((prev) => [...prev, EMPTY_ACTION])}
              >
                <Plus size={12} /> Add action
              </Button>
              <p className="text-[11px] text-slate-500">
                Move targets are workspace folders (Google Drive folders aren't supported by the
                engine).
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" type="button" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending} disabled={isPending}>
              {editingRule ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
