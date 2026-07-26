// ESLint flat config — adapted for OmniDrive monorepo (Hono Workers + React Vite)
// Reference: https://eslint.org/docs/latest/use/configure/migration-guide
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // ── Ignores ──────────────────────────────────────────────
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.wrangler/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.config.{js,ts,mjs,cjs}',
      '**/package-lock.json',
      '**/bun.lock',
      '.github/**',
      'docs/**',
      'scripts/**',
      'packages/worker/scripts/**',
      'examples/**',
      'skills/**',
      '**/*.mjs',
    ],
  },

  // ── Base ─────────────────────────────────────────────────
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── All source files ─────────────────────────────────────
  {
    files: [
      'packages/worker/src/**/*.ts',
      'packages/worker/tests/**/*.ts',
      'packages/web/src/**/*.{ts,tsx}',
    ],
    plugins: {
      security,
    },
    rules: {
      // ── TypeScript ────────────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/ban-ts-comment': ['warn', { minimumDescriptionLength: 5 }],
      '@typescript-eslint/prefer-as-const': 'warn',
      '@typescript-eslint/consistent-type-imports': ['warn', {
        prefer: 'type-imports',
        fixStyle: 'inline-type-imports',
      }],

      // ── General JS ────────────────────────────────────────
      eqeqeq: ['warn', 'always', { null: 'ignore' }],
      curly: ['warn', 'multi-line'],
      'prefer-const': 'warn',
      'no-unused-vars': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-unreachable': 'error',
      'no-case-declarations': 'warn',
      'no-fallthrough': ['warn', { commentPattern: 'falls?\\s?through' }],
      'no-constant-binary-expression': 'warn',
      'no-self-compare': 'warn',
      'no-template-curly-in-string': 'warn',
      'no-unmodified-loop-condition': 'warn',

      // ── Security ──────────────────────────────────────────
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-non-literal-require': 'error',
      'security/detect-unsafe-regex': 'warn',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-bidi-characters': 'warn',

      // ── Disabled (intentional for this codebase) ─────────
      'no-irregular-whitespace': 'off',
      'no-redeclare': 'off',
      'no-undef': 'off', // Workers/browser globals not recognized
      'no-useless-escape': 'off',
    },
  },

  // ── React (web package only) ─────────────────────────────
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ── Modals & dialogs — ban raw <button> to enforce <Button> usage ──
  // Scoped to modal/dialog files only (the unified UI system scope).
  // Pages and other components have many legitimate custom buttons (toolbar,
  // file rows, context menus) that need individual review — separate task.
  // ui/ is exempt (Button component itself lives there).
  {
    files: [
      'packages/web/src/components/*Modal*.tsx',
      'packages/web/src/components/*Dialog*.tsx',
      'packages/web/src/components/workspaces/*Modal*.tsx',
      'packages/web/src/components/workspaces/*Dialog*.tsx',
    ],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "JSXOpeningElement[name.name='button']",
        message: 'Use <Button> from components/ui/Button instead of raw <button>. If this is a truly custom button (folder picker row, breadcrumb link, password toggle), add an eslint-disable-next-line comment.',
      }],
    },
  },

  // ── UI primitives — allow raw <button> (Button component itself) ──
  {
    files: ['packages/web/src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // ── Test files — relax ───────────────────────────────────
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
      'security/detect-object-injection': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // ── MJS files — disable type-checked rules ───────────────
  {
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
);
