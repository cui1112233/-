const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const workbenchRoot = path.resolve(__dirname, '..', 'public', 'novel-panel', 'workbench');
const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0'
};
const assetCacheHeaders = {
  'Cache-Control': 'private, max-age=0, must-revalidate'
};
function workbenchCsp(req) {
  const origin = new URL(`${req.protocol}://${req.get('host')}`).origin;
  const localSource = `'self' ${origin}`;

  return [
    'sandbox allow-scripts allow-forms allow-downloads allow-modals',
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
  res.set(assetCacheHeaders);
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
  return res.sendFile(requestedPath, { root: workbenchRoot });
}

router.get('/workbench', sendWorkbenchHtml);
router.get('/workbench/index.html', sendWorkbenchHtml);
router.get(/^\/workbench\/(.*)$/, sendWorkbenchAsset);

module.exports = router;
