import { request } from './core';
import type { AuditLog, WorkspacePolicy } from '../../types';

export const workspacesApi = {
  getWorkspaces: () =>
    request<{ workspaces: { id: string; name: string; role: string }[] }>('/api/workspaces'),
  getWorkspaceAuditLogs: (workspaceId: string) =>
    request<{ logs: AuditLog[] }>(`/api/workspaces/${workspaceId}/audit-logs`),
  getWorkspacePolicies: (workspaceId: string) =>
    request<{ policies: WorkspacePolicy[] }>(`/api/workspaces/${workspaceId}/policies`),
  createWorkspacePolicy: (
    workspaceId: string,
    data: {
      targetType: 'workspace' | 'folder';
      targetId?: string;
      policyType: 'storage_quota' | 'data_retention';
      config: Record<string, unknown>;
    },
  ) =>
    request<{ policy: WorkspacePolicy }>(`/api/workspaces/${workspaceId}/policies`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteWorkspacePolicy: (workspaceId: string, policyId: string) =>
    request<{ success: boolean }>(`/api/workspaces/${workspaceId}/policies/${policyId}`, {
      method: 'DELETE',
    }),
};
