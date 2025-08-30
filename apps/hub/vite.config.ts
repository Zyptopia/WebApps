// FILE: apps/hub/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

// GitHub Pages needs a non-root base (e.g., /repo-name/).
// We'll inject it at build time via VITE_BASE; default to '/' for local dev.
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react(), tsconfigPaths()],
  resolve: { dedupe: ['react', 'react-dom', 'react/jsx-runtime'] },
  optimizeDeps: { include: ['react', 'react-dom', 'react/jsx-runtime', 'scheduler'] }
});
