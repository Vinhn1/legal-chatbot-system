import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Kiểm tra logic trên phạm vi thay đổi; kiểm tra định dạng cũ tiếp tục nằm trong workflow review.
export default tseslint.config(eslint.configs.recommended, ...tseslint.configs.recommended, {
  languageOptions: { globals: { ...globals.node, ...globals.jest } },
  rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }] },
});
