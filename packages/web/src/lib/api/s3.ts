import { request } from './core';
import type { S3Credential } from '../../types';

export const s3Api = {
  getS3Credentials: () => request<S3Credential[]>('/api/s3-credentials'),
  createS3Credential: (description: string, workspaceId?: string) =>
    request<{
      id: string;
      accessKeyId: string;
      secretAccessKey: string;
      description: string;
      createdAt: string;
    }>('/api/s3-credentials', {
      method: 'POST',
      body: JSON.stringify({ description, workspaceId }),
    }),
  deleteS3Credential: (id: string) =>
    request<void>(`/api/s3-credentials/${id}`, { method: 'DELETE' }),
};
