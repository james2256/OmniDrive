import type { FileService } from '../services/file.service';
import type { FolderService } from '../services/folder.service';
import type { DriveService } from '../services/drive.service';
import type { SharedService } from '../services/shared.service';
import type { WorkspaceService } from '../services/workspace.service';

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  FRONTEND_URL: string;
  WORKER_URL: string;
  JWT_SECRET: string;
  BOOTSTRAP_TOKEN?: string;
  TOKEN_ENCRYPTION_KEY: string;
}

export interface SessionData {
  userId: string;
  username: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  role: 'super_admin' | 'member';
  createdAt: number;
}

export type AppContext = {
  Bindings: Env;
  Variables: {
    userId: string;
    session: SessionData;
    s3WorkspaceId?: string | null;
    fileService: FileService;
    folderService: FolderService;
    driveService: DriveService;
    sharedService: SharedService;
    workspaceService: WorkspaceService;
    requestId: string;
  };
};

export interface ServiceAccountKey {
  clientEmail: string;
  privateKey: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  authType?: 'oauth' | 'service_account';
  serviceAccount?: ServiceAccountKey;
}
