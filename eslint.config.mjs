import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', '**/.next/**', 'apps/web/next-env.d.ts'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  { files: ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}', 'apps/web/**/*.{ts,tsx}'], plugins: { prettier: prettierPlugin }, rules: { 'prettier/prettier': 'error' } },
);
