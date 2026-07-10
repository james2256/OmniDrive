// ESLint flat config (ESLint v9+ standard)
// Reference: https://eslint.org/docs/latest/use/configure/migration-guide
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Ignore generated/build output
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.config.{js,ts,mjs,cjs}',
    ],
  },

  // Base recommended rules
  js.configs.recommended,

  // TypeScript recommended (non-type-checked for speed)
  ...tseslint.configs.recommended,

  // All source files — common rules
  {
    files: ['packages/worker/src/**/*.ts', 'packages/web/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn', // fix existing 100+ incrementally
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // consistent-type-imports disabled — existing code uses inline import() types
      // that would require risky refactoring to fix. Enable after Phase 6 refactor.
      '@typescript-eslint/consistent-type-imports': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      // no-empty relaxed for intentional empty catch blocks (rollback logic)
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Worker-specific: discourage console.log (allow warn/error)
  {
    files: ['packages/worker/src/**/*.ts'],
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Test files — relax some rules
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // Config files — relax
  {
    files: ['*.config.{js,ts,mjs,cjs}', '**/*.config.{js,ts,mjs,cjs}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);
