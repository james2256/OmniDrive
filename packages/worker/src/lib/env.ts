import { z } from 'zod';

/**
 * Validate the Cloudflare Worker / Docker env at boot.
 * Fail-fast with a clear error if any required var is missing or malformed.
 */
const envSchema = z.object({
  DB: z.unknown(),
  KV: z.unknown(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL'),
  WORKER_URL: z.string().url('WORKER_URL must be a valid URL'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be ≥32 characters'),
  TOKEN_ENCRYPTION_KEY: z.string().min(32, 'TOKEN_ENCRYPTION_KEY must be ≥32 characters'),
  BOOTSTRAP_TOKEN: z.string().optional(),
});

export type ValidatedEnv = z.infer<typeof envSchema>;

export function validateEnv(env: Record<string, unknown>): ValidatedEnv {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    console.error('❌ Environment validation failed:');
    for (const [key, msgs] of Object.entries(errors)) {
      console.error(`  ${key}: ${msgs?.join(', ')}`);
    }
    throw new Error('Environment validation failed. See errors above.');
  }
  return result.data;
}
