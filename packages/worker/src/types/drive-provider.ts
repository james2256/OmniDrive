import type { GDriveFile, GDriveFolder } from './google';

/**
 * Contract for cloud storage providers.
 *
 * `GoogleDriveService` implements this interface. Future providers
 * (Dropbox, OneDrive) implement the same interface to plug into the
 * existing routes, services, and sync engine without changes.
 *
 * `hasValidTokens()` is intentionally NOT here — it's a D1 query on
 * `DriveService` (`services/drive.service.ts`), not a provider API call.
 *
 * // ponytail: The return types use `GDriveFile`/`GDriveFolder`, which are
 * Google-specific data shapes. A future refactor should define neutral
 * `CloudFile`/`CloudFolder` types and map at the provider boundary, so a
 * `DropboxService` doesn't have to fit Dropbox data into Google's shape.
 * Deferred because it materially expands scope (every consumer accessing
 * `GDriveFile` fields would need updating). Trigger: start implementing
 * provider #2.
 *
 * // ponytail: This is a 23-method monolithic interface. A future refactor
 * should split into a core `DriveProvider` (~10 methods) + optional
 * capability traits (`DeltaSyncCapable`, `ResumableUploadCapable`,
 * `ShareCapable`, `QuotaCapable`). Deferred because it changes every
 * consumer to do capability checks. Trigger: a provider can't implement
 * one of the methods.
 *
 * // ponytail: Token management internals (`refreshToken`, `loadTokens`,
 * `persistTokens`) stay private in each provider. A future `TokenManager`
 * interface could extract the shared OAuth contract. Trigger: add a 2nd
 * OAuth provider.
 */
export interface DriveProvider {
  // ─── Token management (consumer-facing) ───

  getValidToken(driveAccountId: string): Promise<string>;
  revokeTokens(driveAccountId: string): Promise<void>;

  // ─── File operations ───

  getFile(driveAccountId: string, fileId: string): Promise<GDriveFile>;
  getFileParents(driveAccountId: string, fileId: string): Promise<string[]>;
  downloadFile(
    driveAccountId: string,
    fileId: string,
    mimeType?: string,
    previewMode?: boolean,
  ): Promise<{
    stream: ReadableStream<Uint8Array>;
    exportedMimeType?: string;
    exportedExtension?: string;
  }>;
  deleteFile(driveAccountId: string, fileId: string): Promise<void>;
  trashFile(driveAccountId: string, fileId: string): Promise<void>;
  untrashFile(driveAccountId: string, fileId: string): Promise<void>;
  renameFile(driveAccountId: string, fileId: string, newName: string): Promise<void>;
  copyFile(driveAccountId: string, fileId: string, name?: string): Promise<GDriveFile>;
  moveToFolder(
    driveAccountId: string,
    fileId: string,
    newParentId: string,
    oldParentId: string | null,
  ): Promise<void>;
  shareFile(
    driveAccountId: string,
    fileId: string,
    emailAddress: string,
    role?: string,
    type?: string,
  ): Promise<string>;
  revokeShare(driveAccountId: string, fileId: string, permissionId: string): Promise<void>;

  // ─── Folder operations ───

  getRootFolderId(driveAccountId: string): Promise<string>;
  createFolder(driveAccountId: string, name: string, parentId?: string): Promise<string>;
  trashFolder(driveAccountId: string, folderId: string): Promise<void>;
  untrashFolder(driveAccountId: string, folderId: string): Promise<void>;
  listFolderContents(
    driveAccountId: string,
    folderId: string,
  ): Promise<{ files: GDriveFile[]; folders: GDriveFolder[] }>;
  iterateAllFilesAndFolders(
    driveAccountId: string,
    startPageToken?: string,
  ): AsyncGenerator<{ files: GDriveFile[]; folders: GDriveFolder[]; nextPageToken?: string }>;

  // ─── Upload ───

  initiateResumableUpload(
    driveAccountId: string,
    fileName: string,
    mimeType: string,
    parentFolderId: string,
  ): Promise<string>;

  // ─── Quota ───

  getQuota(driveAccountId: string): Promise<{ total: number; used: number; hasLimit: boolean }>;

  // ─── Sync ───

  getStartPageToken(driveAccountId: string): Promise<string>;

  /**
   * Note: the `file` field uses `GDriveFile`, which has `trashed?: boolean`
   * (optional) and `md5Checksum?: string`. The Google implementation's
   * inline return type has `trashed: boolean` (required) and omits
   * `md5Checksum` from the type (though the `fields` param requests it from
   * the API). The interface's wider type is assignable to the
   * implementation's narrower type — this is a deliberate widening that
   * more accurately reflects the runtime response.
   */
  listChanges(
    driveAccountId: string,
    pageToken: string,
  ): Promise<{
    changes: Array<{ fileId: string; removed: boolean; file?: GDriveFile }>;
    nextPageToken?: string;
    newStartPageToken?: string;
  }>;
}
