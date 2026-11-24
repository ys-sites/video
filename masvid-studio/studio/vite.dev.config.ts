import { defineConfig, mergeConfig } from 'vite';
import studioConfig from './vite.config';
import { isReservedBackendPath } from '../shared/spa-routes.ts';

export default mergeConfig(studioConfig, defineConfig({
  plugins: [{
    name: 'openmotion-studio-dev-backend',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url || '/', 'http://localhost').pathname;
        // Never allow Vite's SPA HTML fallback to swallow reserved backend or MCP endpoints.
        if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Not found' }));
          return;
        }
        if (isReservedBackendPath(pathname) && pathname.startsWith('/.well-known')) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        next();
      });
    },
    // Static analysis imports this file without starting a development server.
    config() {
      const backend = process.env.OPENMOTION_STUDIO_BACKEND;
      if (!backend) throw new Error('Set OPENMOTION_STUDIO_BACKEND to the previewUrl printed by npm start.');

      const target = new URL(backend);
      if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
        || !target.port || target.pathname !== '/' || target.username || target.password || target.search || target.hash) {
        throw new Error('OPENMOTION_STUDIO_BACKEND must be an HTTP loopback origin with a port.');
      }

      // Preserve the browser Host so Studio can check it against Origin on writes.
      // ws: game rooms use a WebSocket on /motion-api/games/:id/rooms/:room.
      const backendProxy = { target: target.origin, changeOrigin: false, ws: true };
      return {
        server: {
          host: '127.0.0.1',
          proxy: {
            '^/(?:api|motion-api|design-api)/': backendProxy,
            '^/__hyperframes_config$': backendProxy,
            '^/connect/': backendProxy,
            '/guide-assets/': backendProxy,
            '/web/catalog/': backendProxy,
          },
        },
      };
    },
  }],
}));
