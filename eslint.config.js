import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

const commonRules = {
  eqeqeq: ['error', 'smart'],
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'all' }],
  'no-implicit-coercion': ['error', { allow: ['!!'] }],
  'no-else-return': 'error',
  'object-shorthand': ['error', 'always']
}

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },

  // TypeScript source
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}', '*.config.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...commonRules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-unused-vars': 'off', // replaced by @typescript-eslint/no-unused-vars
      // Only classic hook rules; newer signal-aware rules flag Preact Signals writes as violations.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },

  // Scripts (Node ESM)
  {
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node }, ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      ...commonRules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  }
)
