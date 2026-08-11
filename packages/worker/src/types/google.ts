/**
 * Google Drive API data shapes.
 *
 * Moved from `services/google-drive.ts` so the upcoming `DriveProvider`
 * interface (`types/drive-provider.ts`) can import them without creating a
 * `types/ → services/` dependency cycle. This file imports nothing — it is
 * a pure leaf type module.
 */

export interface GDriveOwner {
  me: boolean;
  displayName?: string;
  emailAddress?: string;
}

export interface GDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  parents?: string[];
  trashed?: boolean;
  owners?: GDriveOwner[];
  thumbnailLink?: string;
  webViewLink?: string;
  webContentLink?: string;
  createdTime: string;
  modifiedTime: string;
  md5Checksum?: string;
}

export interface GDriveFolder {
  id: string;
  name: string;
  parents?: string[];
  owners?: GDriveOwner[];
}
