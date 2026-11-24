import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveDesignSystemFile } from '../packages/design-system/index.js';
import { openmotionI18nPlugin } from './vite-i18n-plugin';

const local = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  base: '/',
  root: local('./'),
  plugins: [react(), tailwindcss(), openmotionI18nPlugin(), {
    name: 'openmotion-design-system',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const file = resolveDesignSystemFile(new URL(req.url || '/', 'http://localhost').pathname);
        if (!file) return next();
        try {
          const types: Record<string, string> = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.txt': 'text/plain' };
          res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
          res.end(await readFile(local('../packages/design-system/' + file)));
        } catch (error) { next(error); }
      });
    },
  }],
  define: { __STUDIO_VERSION__: JSON.stringify('0.9.7'), ...(!process.env.VITEST ? { 'import.meta.env.VITE_HYPERFRAMES_NO_TELEMETRY': JSON.stringify('1') } : {}) },
  resolve: { alias: [
    { find: 'open-design-ui', replacement: local('../packages/open-design-ui') },
    { find: 'canvas', replacement: local('./src/shims/canvasBrowserStub.js') },
    { find: /^\/design-system\//, replacement: local('../packages/design-system/') },
  ] },
  build: { outDir: 'build', assetsDir: 'editor-assets', emptyOutDir: true, sourcemap: true, chunkSizeWarningLimit: 4500 },
});
