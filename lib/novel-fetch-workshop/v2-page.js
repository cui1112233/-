const fs = require('node:fs');
const path = require('node:path');

const LOGIN_HOTFIX_PATH = '/batch-rewrite/121-login-hotfix.js';
const CLIENT_PATH = '/batch-rewrite/v78-novel-fetch-v2.js';
const DATE_CLIENT_PATH = '/batch-rewrite/v78-novel-fetch-v2-date.js';
const CONFIG_CLIENT_PATH = '/batch-rewrite/v78-novel-fetch-v2-config.js';
const LAYOUT_CLIENT_PATH = '/batch-rewrite/v78-novel-fetch-v2-layout.js';
const RUN_CONTROLS_CLIENT_PATH = '/batch-rewrite/v78-novel-fetch-v2-run-controls.js';
const LOGIN_HOTFIX_TAG = `<script id="qiantie-121-login-hotfix" src="${LOGIN_HOTFIX_PATH}?v=20260909-login-timeout65-r1"></script>`;
const CLIENT_TAG = `<script src="${CLIENT_PATH}?v=20260901-source-aligned-r3"></script>`;
const DATE_CLIENT_TAG = `<script src="${DATE_CLIENT_PATH}?v=20260901-source-aligned-r3"></script>`;
const CONFIG_CLIENT_TAG = `<script src="${CONFIG_CLIENT_PATH}?v=20260901-source-aligned-r3"></script>`;
const LAYOUT_CLIENT_TAG = `<script src="${LAYOUT_CLIENT_PATH}?v=20260901-image-layout-r2"></script>`;
const RUN_CONTROLS_CLIENT_TAG = `<script src="${RUN_CONTROLS_CLIENT_PATH}?v=20260902-run-controls-r2"></script>`;
const LOGIN_HOTFIX_TAG_RE = /<script\b[^>]*\bsrc=["'](?:\.\/|\/batch-rewrite\/)121-login-hotfix\.js(?:\?[^"']*)?["'][^>]*><\/script>/i;

function injectNovelFetchV2Script(html) {
  let source = String(html || '');
  if (!source.includes('</body>')) return source;

  if (LOGIN_HOTFIX_TAG_RE.test(source)) {
    source = source.replace(LOGIN_HOTFIX_TAG_RE, LOGIN_HOTFIX_TAG);
  }

  const tags = [];
  if (!source.includes(LOGIN_HOTFIX_PATH)) tags.push(LOGIN_HOTFIX_TAG);
  if (!source.includes(CLIENT_PATH)) tags.push(CLIENT_TAG);
  if (!source.includes(DATE_CLIENT_PATH)) tags.push(DATE_CLIENT_TAG);
  if (!source.includes(CONFIG_CLIENT_PATH)) tags.push(CONFIG_CLIENT_TAG);
  if (!source.includes(LAYOUT_CLIENT_PATH)) tags.push(LAYOUT_CLIENT_TAG);
  if (!source.includes(RUN_CONTROLS_CLIENT_PATH)) tags.push(RUN_CONTROLS_CLIENT_TAG);
  if (!tags.length) return source;
  return source.replace('</body>', `    ${tags.join('\n    ')}\n  </body>`);
}

function createNovelFetchV2PageMiddleware({ indexPath } = {}) {
  const resolved = indexPath || path.join(__dirname, '..', '..', 'frontend', 'dist', 'batch-rewrite', 'index.html');
  return (req, res, next) => {
    fs.readFile(resolved, 'utf8', (error, html) => {
      if (error) return next();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return res.send(injectNovelFetchV2Script(html));
    });
  };
}

module.exports = { LOGIN_HOTFIX_PATH, CLIENT_PATH, DATE_CLIENT_PATH, CONFIG_CLIENT_PATH, LAYOUT_CLIENT_PATH, RUN_CONTROLS_CLIENT_PATH, injectNovelFetchV2Script, createNovelFetchV2PageMiddleware };
