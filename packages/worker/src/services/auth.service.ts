import type { Env, OAuthTokens } from '../types/env';
import { AppError, UpstreamError } from '../lib/errors';
import { logErrorNoCtx } from '../lib/logger';
import { withBackoff } from '../lib/backoff';

export class AuthService {
  constructor(private env: Env) {}

  /**
   * Fetch with retry + backoff, converting transient Google failures to AppError.
   * Mirrors the pattern in GoogleDriveService.driveFetch — the same OAuth token
   * endpoint is already retried there during refresh; this covers the initial
   * code exchange + userinfo fetch during login.
   */
  private async fetchWithBackoff(
    url: string,
    init: RequestInit,
    errorLabel: string,
  ): Promise<Response> {
    try {
      return await withBackoff(() => fetch(url, init));
    } catch (err) {
      const msg = err instanceof UpstreamError ? err.message : 'Network error';
      logErrorNoCtx(errorLabel, msg);
      throw new AppError(502, 'Failed to communicate with Google');
    }
  }

  async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<OAuthTokens> {
    const params = new URLSearchParams({
      code,
      client_id: this.env.GOOGLE_CLIENT_ID,
      client_secret: this.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    if (codeVerifier) {
      params.append('code_verifier', codeVerifier);
    }
    const response = await this.fetchWithBackoff(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      },
      'OAuth token exchange failed',
    );

    const data = (await response.json()) as unknown as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  async fetchUserInfo(
    accessToken: string,
  ): Promise<{ id: string; email: string; name: string; picture?: string }> {
    const response = await this.fetchWithBackoff(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      'OAuth userinfo fetch failed',
    );

    return (await response.json()) as unknown as {
      id: string;
      email: string;
      name: string;
      picture?: string;
    };
  }
}
