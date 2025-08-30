import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE || '/';
  return {
    base,
    plugins: [react(), tsconfigPaths()],
    resolve: { dedupe: ['react', 'react-dom', 'react/jsx-runtime'] },
    optimizeDeps: { include: ['react', 'react-dom', 'react/jsx-runtime', 'scheduler'] }
  };
});
