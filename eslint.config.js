import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config({ ignores: ['dist/**','node_modules/**'] }, js.configs.recommended, ...tseslint.configs.recommended, { files: ['scripts/*.mjs','tests/integration/*.mjs'], languageOptions: { globals: { process: 'readonly', fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } } });
