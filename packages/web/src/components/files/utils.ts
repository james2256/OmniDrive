/** Returns true for Google-native docs (Docs/Sheets/Slides) that cannot be downloaded directly. */
export function isGoogleNative(mimeType: string | null | undefined): boolean {
  return !!mimeType && mimeType.startsWith('application/vnd.google-apps.');
}

/**
 * Returns the identifier used for folder sharing, selection, and React keys.
 * Drive folders use `googleFolderId`; workspace folders use `id`.
 */
export function getFolderIdentifier(folder: { googleFolderId?: string; id?: string }): string | undefined {
  return 'googleFolderId' in folder ? folder.googleFolderId : folder.id;
}
