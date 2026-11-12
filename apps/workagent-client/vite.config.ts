import { defineConfig } from 'vite';
export default defineConfig({ root: 'apps/workagent-client', build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 4000 }, server: { host: '127.0.0.1' } });
