export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  FRONTEND_URL: string;
  WORKER_URL: string;
}

export interface SessionData {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export type AppContext = {
  Bindings: Env;
  Variables: {
    userId: string;
    session: SessionData;
  };
};

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}
