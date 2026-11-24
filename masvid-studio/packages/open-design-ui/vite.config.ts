import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { 'open-design-ui': fileURLToPath(new URL('.', import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL('../../dist/open-design-ui-site', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: { 'syntax-highlighting': ['@lezer/javascript', '@lezer/highlight'] },
        assetFileNames: asset => asset.names.includes('registry.json')
          ? 'registry.json'
          : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
