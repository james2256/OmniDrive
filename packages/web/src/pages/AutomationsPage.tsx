import { useState } from 'react';
import { Plus, Zap, Pencil, Trash2, ScrollText } from 'lucide-react';
import { useAutomations, useToggleAutomation, useDeleteAutomation } from '../hooks/useAutomations';
import { Button } from '../components/ui/Button';
import { EmptyState, ListSkeleton } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { PageHeader } from '../components/layout/PageHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CreateAutomationModal } from '../components/automation/CreateAutomationModal';
import { AutomationLogsModal } from '../components/automation/AutomationLogsModal';
import type { AutomationRule } from '../types';

export function AutomationsPage() {
  const { data: rules, isLoading, error, refetch } = useAutomations();
  const toggleMutation = useToggleAutomation();
  const deleteMutation = useDeleteAutomation();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [logsRuleId, setLogsRuleId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationRule | null>(null);

  return (
    <div className="p-4 sm:p-6 space-y-2">
      <PageHeader
        title="Automation Rules"
        icon={Zap}
        actions={
          <Button onClick={() => setCreateOpen(true)} variant="primary" className="gap-1.5">
            <Plus size={16} />
            <span className="hidden sm:inline">Create Rule</span>
            <span className="sm:hidden">Create</span>
          </Button>
        }
        bordered={false}
      />

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <ListSkeleton rows={3} />
      ) : !rules || rules.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="No automation rules"
          description="Create a rule to automate file actions like moving or deleting files on upload."
        />
      ) : (
        <div className="bg-card border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="p-4 border-b border-slate-100 last:border-b-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-800 mb-1 truncate">{rule.name}</h3>
                <p className="text-xs text-slate-500">
                  Trigger: <span className="capitalize">{rule.triggerType}</span>
                  {rule.conditions.length > 0 && (
                    <>
                      {' · '}
                      {rule.conditions
                        .map((c) => `${c.field} ${c.operator} "${c.value}"`)
                        .join(', ')}
                    </>
                  )}
                  {' · '}
                  {rule.actions
                    .map((a) =>
                      a.type === 'move' ? `Move to ${a.targetFolderId ?? '?'}` : 'Delete',
                    )
                    .join(', ')}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Button
                  onClick={() => toggleMutation.mutate({ id: rule.id, isActive: !rule.isActive })}
                  variant={rule.isActive ? 'primary' : 'ghost'}
                  className="rounded-lg text-xs flex-shrink-0"
                  disabled={toggleMutation.isPending}
                >
                  {rule.isActive ? 'Active' : 'Inactive'}
                </Button>
                <Button
                  onClick={() => setLogsRuleId(rule.id)}
                  variant="ghost"
                  className="rounded-lg text-xs flex-shrink-0 p-2"
                  aria-label={`View logs for ${rule.name}`}
                  title="View logs"
                >
                  <ScrollText size={14} />
                </Button>
                <Button
                  onClick={() => setEditingRule(rule)}
                  variant="ghost"
                  className="rounded-lg text-xs flex-shrink-0 p-2"
                  aria-label={`Edit ${rule.name}`}
                  title="Edit"
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  onClick={() => setDeleteTarget(rule)}
                  variant="ghost"
                  className="rounded-lg text-xs flex-shrink-0 p-2 text-red-600 hover:bg-red-50"
                  aria-label={`Delete ${rule.name}`}
                  title="Delete"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateAutomationModal
        open={createOpen}
        editingRule={null}
        onClose={() => setCreateOpen(false)}
      />

      {editingRule && (
        <CreateAutomationModal
          open={true}
          editingRule={editingRule}
          onClose={() => setEditingRule(null)}
        />
      )}

      <AutomationLogsModal
        ruleId={logsRuleId}
        ruleName={rules?.find((r) => r.id === logsRuleId)?.name ?? null}
        onClose={() => setLogsRuleId(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Automation Rule"
        message={`Delete "${deleteTarget?.name}"? This also removes its execution logs. This cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteMutation.mutateAsync(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
        onClose={() => !deleteMutation.isPending && setDeleteTarget(null)}
      />
    </div>
  );
}
