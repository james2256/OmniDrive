import { request, ApiError } from './core';
import type { SharedLink, SharedMetaResponse, CreateSharedLinkPayload } from '../../types';

export const sharedApi = {
  createSharedLink: async (payload: CreateSharedLinkPayload) => {
    return request<{ id: string; url: string }>('/api/shared', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  updateSharedLink: async (id: string, payload: Partial<CreateSharedLinkPayload>) => {
    return request<void>(`/api/shared/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  getSharedLinks: async () => {
    return request<{ links: SharedLink[] }>('/api/shared');
  },
  deleteSharedLink: async (id: string) => {
    return request<void>(`/api/shared/${id}`, { method: 'DELETE' });
  },
  getSharedMeta: async (id: string) => {
    try {
      return await request<SharedMetaResponse>(`/api/shared/${id}/meta`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return { requiresPassword: true };
      }
      throw error;
    }
  },
  verifySharedPassword: async (id: string, password: string) => {
    return request<void>(`/api/shared/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }).catch((error) => {
      if (error instanceof ApiError && error.status === 401) {
        throw new Error('Invalid password');
      }
      throw error;
    });
  },
};
