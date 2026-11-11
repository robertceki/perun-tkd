module.exports = {
  root: true,
  env: { browser: true, es2020: true, node: true },
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:react-hooks/recommended'],
  ignorePatterns: ['.codex/', '.tmnt/', 'node_modules/', 'dist/', 'coverage/', 'playwright-report/', 'test-results/', '**/*.generated.*', '**/*.d.ts'],
  overrides: [{ files: ['*.cjs'], parser: 'espree' }],
  rules: { 'react-refresh/only-export-components': ['warn', { allowConstantExport: true }] },
}
