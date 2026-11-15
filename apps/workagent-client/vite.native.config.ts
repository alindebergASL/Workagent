import { defineConfig } from 'vite';
export default defineConfig({ root: 'apps/workagent-client', build: { outDir: 'dist-native', rollupOptions: { input: 'apps/workagent-client/native.html' }, sourcemap: false, chunkSizeWarningLimit: 4000 } });
