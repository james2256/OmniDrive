import { GoogleDriveService } from '../services/google-drive';
import type { DriveProvider } from '../types/drive-provider';
import type { Env } from '../types/env';

/**
 * Subset of {@link Env} needed to construct a {@link GoogleDriveService}.
 *
 * Accepted by {@link createDriveService} so callers that only have a partial
 * env (e.g. `runScheduledSync`'s narrowed param) can use the factory without
 * having to satisfy every field on the full `Env` interface.
 */
export type DriveServiceEnv = Pick<
  Env,
  'DB' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET' | 'TOKEN_ENCRYPTION_KEY'
>;

/**
 * Single point of construction for {@link GoogleDriveService}.
 *
 * Replaces the scattered `new GoogleDriveService(env.DB, env.GOOGLE_CLIENT_ID,
 * env.GOOGLE_CLIENT_SECRET, env.TOKEN_ENCRYPTION_KEY)` call sites so the
 * constructor signature can evolve without touching every route/service.
 *
 * Usable both inside middleware (for context injection) and standalone (in
 * services/cron that receive `env` directly). Routes with a Hono context
 * should prefer `createDriveService(c.env)`; services that take a narrowed
 * env param can pass it straight through.
 */
export function createDriveService(env: DriveServiceEnv): DriveProvider {
  return new GoogleDriveService(
    env.DB,
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.TOKEN_ENCRYPTION_KEY,
  );
}
