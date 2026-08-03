import type { FileService } from '../services/file.service';
import type { FolderService } from '../services/folder.service';
import type { DriveService } from '../services/drive.service';
import type { SharedService } from '../services/shared.service';
import type { WorkspaceService } from '../services/workspace.service';
import type { AutomationRepository } from '../repositories/automation.repository';
import type { S3CredentialsRepository } from '../repositories/s3-credentials.repository';
import type { AdminRepository } from '../repositories/admin.repository';
import type { AuthRepository } from '../repositories/auth.repository';
import type { Env, SessionData } from './env';

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
    automationRepo: AutomationRepository;
    s3CredentialsRepo: S3CredentialsRepository;
    adminRepo: AdminRepository;
    authRepo: AuthRepository;
    requestId: string;
  };
};
