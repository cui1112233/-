const fs = require('node:fs');
const path = require('node:path');

const CLIENT_PATH = '/batch-rewrite/v78-novel-fetch-v2.js';
const DATE_CLIENT_PATH = '/batch-rewrite/v78-novel-fetch-v2-date.js';
const CONFIG_CLIENT_PATH = '/batch-rewrite/v78-novel-fetch-v2-config.js';
const LAYOUT_CLIENT_PATH = '/batch-rewrite/v78-novel-fetch-v2-layout.js';
const RUN_CONTROLS_CLIENT_PATH = '/batch-rewrite/v78-novel-fetch-v2-run-controls.js';
const CLIENT_TAG = `<script src="${CLIENT_PATH}?v=20260901-source-aligned-r3"></script>`;
const DATE_CLIENT_TAG = `<script src="${DATE_CLIENT_PATH}?v=20260901-source-aligned-r3"></script>`;
const CONFIG_CLIENT_TAG = `<script src="${CONFIG_CLIENT_PATH}?v=20260901-source-aligned-r3"></script>`;
const LAYOUT_CLIENT_TAG = `<script src="${LAYOUT_CLIENT_PATH}?v=20260901-image-layout-r2"></script>`;
const RUN_CONTROLS_CLIENT_TAG = `<script src="${RUN_CONTROLS_CLIENT_PATH}?v=20260901-run-controls-r1"></script>`;

function injectNovelFetchV2Script(html) {
  let source = String(html || '');
  if (!source.includes('</body>')) return source;
  const tags = [];
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

module.exports = { CLIENT_PATH, DATE_CLIENT_PATH, CONFIG_CLIENT_PATH, LAYOUT_CLIENT_PATH, RUN_CONTROLS_CLIENT_PATH, injectNovelFetchV2Script, createNovelFetchV2PageMiddleware };