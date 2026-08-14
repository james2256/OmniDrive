// Google API endpoints
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

// Time constants (milliseconds) — shared across middleware + services
export const FIVE_MINUTES_MS = 5 * 60 * 1000;
export const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
export const ONE_HOUR_MS = 60 * 60 * 1000;

// Token refresh safety margin — refresh this far before actual expiry
// to avoid serving a token that expires mid-request. Used in getValidToken.
export const TOKEN_REFRESH_MARGIN_MS = 60_000;

export const DEFAULT_FOLDER_ICON = '📁';
export const DEFAULT_FOLDER_COLOR = '#4A90D9';
