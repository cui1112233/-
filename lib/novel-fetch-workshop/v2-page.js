const fs = require('node:fs');
const path = require('node:path');

const CLIENT_PATH = '/batch-rewrite/v78-novel-fetch-v2.js';
const CONFIG_CLIENT_PATH = '/batch-rewrite/v78-novel-fetch-v2-config.js';
const CLIENT_TAG = `<script src="${CLIENT_PATH}?v=20260831-v78-v2-p2"></script>`;
const CONFIG_CLIENT_TAG = `<script src="${CONFIG_CLIENT_PATH}?v=20260831-v78-v2-p2"></script>`;

function injectNovelFetchV2Script(html) {
  let source = String(html || '');
  if (!source.includes('</body>')) return source;
  const tags = [];
  if (!source.includes(CLIENT_PATH)) tags.push(CLIENT_TAG);
  if (!source.includes(CONFIG_CLIENT_PATH)) tags.push(CONFIG_CLIENT_TAG);
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

module.exports = { CLIENT_PATH, CONFIG_CLIENT_PATH, injectNovelFetchV2Script, createNovelFetchV2PageMiddleware };
