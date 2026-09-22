const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const router = express.Router();
const workbenchRoot = path.resolve(__dirname, '..', 'public', 'novel-panel', 'workbench');
const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0'
};
const assetCacheHeaders = {
  'Cache-Control': 'public, max-age=300, must-revalidate'
};
const COMPRESSIBLE_ASSET_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.svg', '.txt', '.xml']);
const compressedAssetCache = new Map();

function getWorkbenchAssetCacheHeaders() {
  return { ...assetCacheHeaders };
}

function shouldCompressWorkbenchAsset(requestedPath) {
  return COMPRESSIBLE_ASSET_EXTENSIONS.has(path.extname(String(requestedPath || '')).toLowerCase());
}

function preferredCompression(req) {
  const accepted = String(req.headers?.['accept-encoding'] || '').toLowerCase();
  if (accepted.includes('br')) return 'br';
  if (accepted.includes('gzip')) return 'gzip';
  return '';
}

function compressBuffer(raw, encoding) {
  return new Promise((resolve, reject) => {
    const callback = (error, result) => error ? reject(error) : resolve(result);
    if (encoding === 'br') return zlib.brotliCompress(raw, callback);
    return zlib.gzip(raw, callback);
  });
}

async function readCompressedAsset(assetPath, encoding) {
  const stat = await fs.promises.stat(assetPath);
  const key = `${assetPath}:${stat.size}:${stat.mtimeMs}:${encoding}`;
  const cached = compressedAssetCache.get(key);
  if (cached) return cached;
  const body = await compressBuffer(await fs.promises.readFile(assetPath), encoding);
  for (const existingKey of compressedAssetCache.keys()) {
    if (existingKey.startsWith(`${assetPath}:`)) compressedAssetCache.delete(existingKey);
  }
  compressedAssetCache.set(key, body);
  return body;
}
function workbenchCsp(req) {
  const origin = new URL(`${req.protocol}://${req.get('host')}`).origin;
  const localSource = `'self' ${origin}`;

  return [
    'sandbox allow-scripts allow-forms allow-downloads allow-modals allow-same-origin',
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    `img-src ${localSource} data: blob:`,
    `media-src ${localSource} data: blob:`,
    `style-src 'self' 'unsafe-inline' ${origin}`,
    `script-src 'self' 'unsafe-inline' ${origin}`,
    `connect-src ${localSource}`
  ].join('; ');
}

function setNoStore(res) {
  res.set(noStoreHeaders);
}

function setAssetCache(res) {
  res.set(getWorkbenchAssetCacheHeaders());
}

function sendWorkbenchHtml(req, res) {
  const indexPath = path.join(workbenchRoot, 'index.html');
  if (!fs.existsSync(indexPath)) return res.status(404).send('Novel panel workbench assets are not synced.');
  setNoStore(res);
  res.set('Content-Security-Policy', workbenchCsp(req));
  return res.sendFile('index.html', { root: workbenchRoot });
}

function sendWorkbenchAsset(req, res) {
  let requestedPath;
  try {
    requestedPath = decodeURIComponent(req.params[0] || '');
  } catch (_) {
    return res.status(400).send('Invalid workbench asset path.');
  }

  const assetPath = path.resolve(workbenchRoot, requestedPath);
  if (!requestedPath || (assetPath !== workbenchRoot && !assetPath.startsWith(`${workbenchRoot}${path.sep}`))) {
    return res.status(404).send('Not found');
  }

  try {
    if (!fs.statSync(assetPath).isFile()) return res.status(404).send('Not found');
  } catch (_) {
    return res.status(404).send('Not found');
  }

  setAssetCache(res);
  const encoding = shouldCompressWorkbenchAsset(requestedPath) ? preferredCompression(req) : '';
  if (!encoding) return res.sendFile(requestedPath, { root: workbenchRoot });

  return readCompressedAsset(assetPath, encoding).then(body => {
    res.type(path.extname(requestedPath));
    res.set({
      'Content-Encoding': encoding,
      'Vary': 'Accept-Encoding',
      'Content-Length': String(body.length)
    });
    if (req.method === 'HEAD') return res.end();
    return res.send(body);
  }).catch(() => res.status(500).send('Workbench asset compression failed.'));
}

router.get('/workbench', sendWorkbenchHtml);
router.get('/workbench/index.html', sendWorkbenchHtml);
router.get(/^\/workbench\/(.*)$/, sendWorkbenchAsset);

module.exports = router;
module.exports.getWorkbenchAssetCacheHeaders = getWorkbenchAssetCacheHeaders;
module.exports.shouldCompressWorkbenchAsset = shouldCompressWorkbenchAsset;
