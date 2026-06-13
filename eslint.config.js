import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `.venv` is the Python sidecar's virtualenv (gitignored, but eslint doesn't read
    // .gitignore); it contains third-party JS with browser globals.
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.venv/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
);
