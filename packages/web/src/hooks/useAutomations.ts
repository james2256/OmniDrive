import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { automationsApi, type AutomationRuleBody } from '../lib/api/automations';
import { qk } from '../lib/queryKeys';
import { useToastStore } from '../stores/useToastStore';
import type { AutomationLog } from '../types';

/** List all automation rules for the current user. */
export function useAutomations() {
  return useQuery({
    queryKey: qk.automations,
    queryFn: async () => {
      const { rules } = await automationsApi.getAutomations();
      return rules;
    },
  });
}

/** Toggle a rule's active state (pessimistic — invalidates after server confirms). */
export function useToggleAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      automationsApi.toggleAutomation(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.automations }),
  });
}

/** Create a new automation rule. */
export function useCreateAutomation() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: (body: AutomationRuleBody) => automationsApi.createAutomation(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.automations });
      addToast('success', 'Automation rule created');
    },
    onError: () => addToast('error', 'Failed to create rule'),
  });
}

/** Update an existing automation rule (full replace). */
export function useUpdateAutomation() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AutomationRuleBody }) =>
      automationsApi.updateAutomation(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.automations });
      addToast('success', 'Automation rule updated');
    },
    onError: () => addToast('error', 'Failed to update rule'),
  });
}

/** Delete an automation rule (cascades to logs). */
export function useDeleteAutomation() {
  const qc = useQueryClient();
  const { addToast } = useToastStore();
  return useMutation({
    mutationFn: (id: string) => automationsApi.deleteAutomation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.automations });
      addToast('success', 'Automation rule deleted');
    },
    onError: () => addToast('error', 'Failed to delete rule'),
  });
}

/** Fetch execution logs for a rule. Disabled when ruleId is null (modal closed). */
export function useAutomationLogs(ruleId: string | null): {
  logs: AutomationLog[];
  isLoading: boolean;
  error: unknown;
} {
  const { data, isLoading, error } = useQuery({
    queryKey: qk.automationLogs(ruleId ?? ''),
    queryFn: async () => {
      const { logs } = await automationsApi.getAutomationLogs(ruleId as string);
      return logs;
    },
    enabled: !!ruleId,
  });
  return { logs: data ?? [], isLoading, error };
}
