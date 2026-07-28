// ─── API Response / Transport Types ───
//
// Shapes returned by HTTP route handlers and consumed by the web client.
// These compose domain types from domain.ts into response envelopes and
// view-models (e.g. breadcrumb items, folder listings, upload handshakes).

import type { FileEntry, VirtualFolder } from './domain';

export interface FolderContents {
  folder: VirtualFolder | null;
  subfolders: VirtualFolder[];
  files: (FileEntry & { driveEmail: string })[];
  breadcrumb: BreadcrumbItem[];
}

export interface BreadcrumbItem {
  id: string | null;
  name: string;
}

export interface UploadInitResponse {
  uploadUrl: string;
  driveAccountId: string;
  googleFolderId: string;
}
