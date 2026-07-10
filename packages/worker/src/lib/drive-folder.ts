import type { DriveAccount } from '../types';

export function resolveGoogleFolderId(drive: Pick<DriveAccount, 'rootFolderId'>, googleFolderId: string): string {
  if (googleFolderId === 'root' && drive.rootFolderId) {
    return drive.rootFolderId;
  }
  return googleFolderId;
}

export async function resolveSyncRootFolderId(
  drive: DriveAccount,
  getOAuthRoot: () => Promise<string>
): Promise<string> {
  if (drive.type === 'service_account' && drive.rootFolderId) {
    return drive.rootFolderId;
  }
  return getOAuthRoot();
}