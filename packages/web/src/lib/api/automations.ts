import { request } from './core';
import type { AutomationRule } from '../../types';

export const automationsApi = {
  getAutomations: () => request<{ rules: AutomationRule[] }>('/api/automations'),
  toggleAutomation: (id: string, is_active: boolean) =>
    request<{ success: boolean }>(`/api/automations/${id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active }),
    }),
};
