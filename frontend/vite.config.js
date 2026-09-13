import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const rootDir = dirname(fileURLToPath(import.meta.url));

// The management console has its own React entrypoint.  The production server
// already maps /admin/* to admin.html, but Vite's generic SPA fallback used to
// load index.html (the user app) for a direct local visit such as
// /admin/presets.  Rewrite it before that fallback so local development uses
// the same entrypoint as production.
const adminRouteEntry = {
  name: 'admin-route-entry',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.method === 'GET' || req.method === 'HEAD') {
        const [pathname, query] = (req.url || '').split('?', 2);
        if (pathname === '/admin' || pathname.startsWith('/admin/')) {
          req.url = `/admin.html${query ? `?${query}` : ''}`;
        }
      }
      next();
    });
  }
};

export default defineConfig({
  plugins: [react(), adminRouteEntry],
  assetsInclude: ['**/*.glb'],
  build: {
    rollupOptions: {
      input: {
        user: resolve(rootDir, 'index.html'),
        admin: resolve(rootDir, 'admin.html')
      }
    }
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:13190'
    }
  }
});
