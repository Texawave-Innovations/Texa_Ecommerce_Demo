import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const firebaseImports = [{ group: ['firebase', 'firebase/*', 'firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*', '@google-cloud/*'], message: 'Only packages/data, functions, apps/tally-agent, scripts/seed and tests may import Firebase. UI must use repository interfaces from @texafashions/data.' }];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/lib/**', '**/dist/**', '**/.turbo/**', '**/next-env.d.ts', '.emulator-data/**'] },
  js.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-imports': ['error', { patterns: firebaseImports }],
    },
  },
  // Allowed Firebase consumers
  { files: ['packages/data/**', 'functions/**', 'apps/tally-agent/**', 'scripts/**', 'tests/**'], rules: { 'no-restricted-imports': 'off' } },
  // Pure domain: no I/O libraries at all
  { files: ['packages/domain/**'], rules: { 'no-restricted-imports': ['error', { patterns: [...firebaseImports, { group: ['node:*', 'fs', 'path'], message: 'packages/domain must stay pure.' }] }] } },
);
