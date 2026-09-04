import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // ─── Import boundary: INV-17 / INV-2 ───────────────────────────────────
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@alpacahq/*', 'alpaca-trade-api'],
              message: 'The Alpaca SDK is worker-only. api/ and web/ must never import it (INV-2).',
            },
          ],
        },
      ],
    },
  },
  // Worker: no importing api/src
  {
    files: ['worker/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../api/src/**', '../../api/src/**', '@stockwatch/api'],
              message: 'Worker must never import from api/ (INV-17).',
            },
          ],
        },
      ],
    },
  },
  // API + Web: no importing worker/src or Alpaca SDK
  {
    files: ['api/**/*.ts', 'web/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@alpacahq/*', 'alpaca-trade-api'],
              message: 'The Alpaca SDK is worker-only (INV-2, INV-17).',
            },
            {
              group: ['../worker/src/**', '../../worker/src/**', '@stockwatch/worker'],
              message: 'api/ must never import from worker/ (INV-17).',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
);
