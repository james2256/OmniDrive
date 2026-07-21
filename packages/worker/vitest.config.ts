import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    exclude: ['tests/integration/**', 'node_modules/**'],
  },
});
