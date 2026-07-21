import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Separate config for integration tests — uses real D1 + KV via Miniflare.
// The existing 239 unit tests use the default vitest.config.ts (mocked D1).
// Run with: npm run test:integration
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        compatibilityFlags: ['nodejs_compat'],
        // Test-only bindings — these override wrangler.toml values for local tests
        bindings: {
          JWT_SECRET: 'test-jwt-secret-min-32-chars-long-aaaa',
          TOKEN_ENCRYPTION_KEY: '0'.repeat(64),
          GOOGLE_CLIENT_ID: '',
          GOOGLE_CLIENT_SECRET: '',
          FRONTEND_URL: 'http://localhost:5173',
          WORKER_URL: 'http://localhost:8888',
        },
      },
    }),
  ],
  test: {
    globals: true,
    root: '.',
    include: ['tests/integration/**/*.test.ts'],
  },
});
