const express = require('express');

const { apiAuth } = require('../middleware/auth');
const { publicPreset } = require('../lib/preset-store');

function sendStoreError(res, error) {
  if (error?.code === 'NOT_FOUND') return res.status(404).json({ error: 'Not found' });
  if (error?.code === 'FORBIDDEN') return res.status(403).json({ error: 'Forbidden' });
  if (error?.code === 'CONFLICT') return res.status(409).json({ error: error.message });
  return res.status(400).json({ error: error?.message || 'Invalid request' });
}

function createPresetsRouter(presetStore) {
  if (!presetStore) throw new Error('presetStore is required');
  const router = express.Router();
  router.use(apiAuth);

  router.get('/', (req, res) => {
    try {
      res.json({ catalog: presetStore.listCatalog(req.query.module) });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  router.post('/resolve', (req, res) => {
    try {
      const selection = presetStore.resolveSelection(req.body);
      res.json({ presets: [selection.base, ...selection.addons].map(publicPreset) });
    } catch (error) {
      sendStoreError(res, error);
    }
  });

  return router;
}

module.exports = { createPresetsRouter };
