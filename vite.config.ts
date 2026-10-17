import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// AC-99: each page is its own JS chunk (App.tsx lazy routes). The CSS stays one file, loaded first: page styles share global
// rules (policy.css styles every select and table), so a split would restyle a screen by the order pages were visited.
export default defineConfig({ plugins: [react()], publicDir: 'web/public', build: { outDir: 'dist', cssCodeSplit: false } });
