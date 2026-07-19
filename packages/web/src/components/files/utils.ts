/** Returns true for Google-native docs (Docs/Sheets/Slides) that cannot be downloaded directly. */
export function isGoogleNative(mimeType: string | null | undefined): boolean {
  return !!mimeType && mimeType.startsWith('application/vnd.google-apps.');
}
