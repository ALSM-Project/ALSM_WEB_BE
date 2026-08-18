import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
export default tseslint.config(eslint.configs.recommended, ...tseslint.configs.recommended, prettier, {
  files: ['**/*.ts'], languageOptions: { globals: globals.node },
  rules: { '@typescript-eslint/no-explicit-any': 'error' }
});
