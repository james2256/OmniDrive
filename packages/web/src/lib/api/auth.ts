import { request } from './core';
import type { SessionData, LoginPayload, RegisterPayload } from '../../types';

export const authApi = {
  getSetupStatus: () => request<{ isSetup: boolean }>('/api/auth/setup-status'),
  login: (data: LoginPayload) =>
    request<{ success: boolean; user: SessionData }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  register: (data: RegisterPayload) =>
    request<{ success: boolean; user: SessionData }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getUser: () => request<{ user: SessionData }>('/api/auth/me'),
  getGoogleOAuthUrl: () => request<{ url: string }>('/api/auth/google'),
  getDriveConnectUrl: () => request<{ url: string }>('/api/drives/connect'),
  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ success: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};
