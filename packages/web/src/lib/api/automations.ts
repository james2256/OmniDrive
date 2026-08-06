import { request } from './core';
import type { AutomationRule, AutomationLog, RuleCondition, RuleAction } from '../../types';

export interface AutomationRuleBody {
  name: string;
  triggerType: 'event' | 'cron';
  triggerConfig?: Record<string, unknown>;
  conditions?: RuleCondition[];
  actions?: RuleAction[];
}

export const automationsApi = {
  getAutomations: () => request<{ rules: AutomationRule[] }>('/api/automations'),
  createAutomation: (body: AutomationRuleBody) =>
    request<{ id: string }>('/api/automations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateAutomation: (id: string, body: AutomationRuleBody) =>
    request<void>(`/api/automations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteAutomation: (id: string) => request<void>(`/api/automations/${id}`, { method: 'DELETE' }),
  toggleAutomation: (id: string, isActive: boolean) =>
    request<void>(`/api/automations/${id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),
  getAutomationLogs: (id: string) =>
    request<{ logs: AutomationLog[] }>(`/api/automations/${id}/logs`),
};
