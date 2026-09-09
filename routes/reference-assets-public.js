const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const { createNovelPanelPremiumStore } = require('../lib/novel-panel/premium-store');
const { verifyReferenceAssetCapability } = require('../lib/novel-panel/reference-asset-capability');

function imageMime(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function streamImageFile(res, filePath) {
  const stream = fs.createReadStream(filePath);
  stream.once('error', error => {
    if (!res.headersSent) return res.status(404).json({ error: '参考图片不存在。', code: 'REFERENCE_ASSET_NOT_FOUND' });
    return res.destroy(error);
  });
  stream.pipe(res);
}

function createReferenceAssetPublicRouter({ usersDir, secret = '', now = Date.now } = {}) {
  if (typeof usersDir !== 'string' || !usersDir.trim()) throw new Error('usersDir is required');
  const router = express.Router();
  const store = createNovelPanelPremiumStore({ usersDir });

  router.get('/h3/:assetType/:assetId/:variant', (req, res) => {
    const username = String(req.query.u || '').trim();
    const assetType = String(req.params.assetType || '').trim();
    const assetId = String(req.params.assetId || '').trim();
    const variant = String(req.params.variant || '').trim();
    if (!verifyReferenceAssetCapability({
      secret,
      username,
      assetType,
      assetId,
      variant,
      expiresAt: req.query.e,
      signature: req.query.s,
      now
    })) {
      return res.status(404).json({ error: '参考图片不存在。', code: 'REFERENCE_ASSET_NOT_FOUND' });
    }
    try {
      const filePath = store.assetFilePath(username, assetType, assetId, variant);
      if (!filePath) return res.status(404).json({ error: '参考图片不存在。', code: 'REFERENCE_ASSET_NOT_FOUND' });
      res.set('Cache-Control', 'private, no-store');
      res.set('Content-Type', imageMime(filePath));
      res.set('X-Content-Type-Options', 'nosniff');
      streamImageFile(res, filePath);
      return undefined;
    } catch {
      return res.status(404).json({ error: '参考图片不存在。', code: 'REFERENCE_ASSET_NOT_FOUND' });
    }
  });

  return router;
}

module.exports = { createReferenceAssetPublicRouter };
