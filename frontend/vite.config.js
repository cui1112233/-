import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { normalizeGiantMaterialId, normalizeGiantMaterialResponse } from './src/user/pages/giantMaterialTest.js';

const rootDir = dirname(fileURLToPath(import.meta.url));
const GIANT_MATERIAL_SELECT_URL = 'https://n8.hnqingyuwen.top/center-api/material/video/select';

function isLoopbackAddress(value) {
  const address = String(value || '').trim().replace(/^::ffff:/, '');
  return address === '127.0.0.1' || address === '::1' || address === 'localhost';
}

async function readJsonBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 1024 * 1024) throw Object.assign(new Error('请求体过大'), { code: 'REQUEST_TOO_LARGE' });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {
    throw Object.assign(new Error('请求体不是有效 JSON'), { code: 'INVALID_JSON' });
  }
}

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function createGiantMaterialTestHandler({ fetchImpl = fetch, getToken = () => process.env.QINGYU_N8_ADMIN_TOKEN, now = () => Date.now() } = {}) {
  return async function giantMaterialTestHandler(req, res, overrides = {}) {
    if (!isLoopbackAddress(req.socket?.remoteAddress)) return writeJson(res, 403, { ok: false, code: 'LOOPBACK_ONLY' });
    if (String(req.method || '').toUpperCase() !== 'POST') return writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
    try {
      const body = await readJsonBody(req);
      const giantMaterialId = normalizeGiantMaterialId(body?.giantMaterialId);
      if (!giantMaterialId) return writeJson(res, 400, { ok: false, code: 'INVALID_GIANT_MATERIAL_ID' });
      const token = String(overrides.token ?? getToken() ?? '').trim();
      if (!token) return writeJson(res, 503, { ok: false, code: 'QINGYU_AUTH_NOT_CONFIGURED' });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      let upstream;
      try {
        upstream = await fetchImpl(GIANT_MATERIAL_SELECT_URL, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ocean_material_ids: giantMaterialId }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }
      if (upstream.status === 401 || upstream.status === 403) return writeJson(res, 401, { ok: false, code: 'QINGYU_AUTH_FAILED' });
      if (!upstream.ok) return writeJson(res, 502, { ok: false, code: 'QINGYU_UPSTREAM_FAILED', status: upstream.status });
      const payload = await upstream.json();
      const material = normalizeGiantMaterialResponse(payload);
      if (!material.materialId || !material.videoUrl) return writeJson(res, 502, { ok: false, code: 'QINGYU_MATERIAL_RESPONSE_INVALID' });
      return writeJson(res, 200, { ok: true, stage: 'resolved', observedAt: new Date(now()).toISOString(), material });
    } catch (error) {
      const code = error?.code === 'REQUEST_TOO_LARGE' || error?.code === 'INVALID_JSON' ? error.code : error?.name === 'AbortError' ? 'QINGYU_TIMEOUT' : 'QINGYU_UPSTREAM_ERROR';
      const status = code === 'REQUEST_TOO_LARGE' || code === 'INVALID_JSON' ? 400 : code === 'QINGYU_TIMEOUT' ? 504 : 502;
      return writeJson(res, status, { ok: false, code });
    }
  };
}

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

const giantMaterialTestApi = {
  name: 'giant-material-test-api',
  configureServer(server) {
    server.middlewares.use('/__local/giant-material-test/resolve', createGiantMaterialTestHandler());
  }
};

export default defineConfig({
  plugins: [react(), adminRouteEntry, giantMaterialTestApi],
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
      // Batch Factory V11 can be served by its dedicated local preview while
      // Shuihuo keeps using the selected review platform.
      '/api/batch-factory/v11': process.env.QIANTIE_DEV_BATCH_FACTORY_API_ORIGIN || 'http://127.0.0.1:13190',
      '/api': process.env.QIANTIE_DEV_API_ORIGIN || 'http://127.0.0.1:13190'
    }
  }
});
