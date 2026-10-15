import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Public values (RLS protects data); single source is wrangler.toml [vars].
const vars = readFileSync('wrangler.toml', 'utf8')
const v = (k: string) => JSON.stringify(new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, 'm').exec(vars)?.[1] ?? '')

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': v('SUPABASE_URL'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': v('SUPABASE_ANON_KEY'),
  },
})
