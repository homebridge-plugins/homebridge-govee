import { antfu } from '@antfu/eslint-config'

/** @type {typeof antfu} */
export default antfu(
  {
    ignores: [],
    jsx: false,
    rules: {
      'curly': ['error', 'multi-line'],
      'new-cap': 'off',
      'no-undef': 'error',
      'perfectionist/sort-exports': 'error',
      'perfectionist/sort-imports': [
        'error',
        {
          groups: [
            ['type-builtin', 'type-external', 'type-internal'],
            ['type-parent', 'type-sibling', 'type-index'],
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling', 'index'],
            'side-effect',
            'unknown',
          ],
          order: 'asc',
          type: 'natural',
          newlinesBetween: 1,
        },
      ],
      'perfectionist/sort-named-exports': 'error',
      'perfectionist/sort-named-imports': 'error',
      'quotes': ['error', 'single'],
      'sort-imports': 0,
      'style/brace-style': [
        'error',
        '1tbs',
        { allowSingleLine: true },
      ],
      'style/quote-props': ['error', 'consistent-as-needed'],
      'test/no-only-tests': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        { caughtErrors: 'none' },
      ],
    },
    typescript: false,
  },
  {
    files: ['**/*.md'],
    rules: {
      'perfectionist/sort-exports': 'off',
      'perfectionist/sort-imports': 'off',
      'perfectionist/sort-named-exports': 'off',
      'perfectionist/sort-named-imports': 'off',
    },
  },
)
