import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['tests/**/*.test.ts', 'src/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/tests/**',
        'src/types/**',
        'src/polyfills/**',
        'src/db/**',
      ],
      reportsDirectory: './coverage',
      thresholds: {
        // Don't fail builds on coverage — existing code has gaps.
        // Enable after Phase 6 refactor improves coverage.
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
