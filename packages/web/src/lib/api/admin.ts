import { request } from './core';
import type { AdminUser, Invitation, AdminCreateUserPayload } from '../../types';

export const adminApi = {
  getInvitations: () => request<{ invitations: Invitation[] }>('/api/admin/invitations'),
  createInvitation: (code: string, max_uses: number) =>
    request<{ success: boolean; invitation: Invitation }>('/api/admin/invitations', {
      method: 'POST',
      body: JSON.stringify({ code, max_uses }),
    }),
  deleteInvitation: (id: string) =>
    request<{ success: boolean }>(`/api/admin/invitations/${id}`, { method: 'DELETE' }),
  getAdminUsers: () => request<{ users: AdminUser[] }>('/api/admin/users'),
  adminCreateUser: (data: AdminCreateUserPayload) =>
    request<{ success: boolean; user: AdminUser }>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateUserRole: (id: string, role: 'super_admin' | 'member') =>
    request<{ success: boolean }>(`/api/admin/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  updateUserStatus: (id: string, status: 'active' | 'blocked') =>
    request<{ success: boolean }>(`/api/admin/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  deleteUser: (id: string) =>
    request<{ success: boolean }>(`/api/admin/users/${id}`, { method: 'DELETE' }),
};
