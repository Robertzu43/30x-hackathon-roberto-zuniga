import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.wrangler', '.claude', 'scripts'] },
  ...tseslint.configs.recommended,
)
