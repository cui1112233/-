const express = require('express');
const { apiAuth } = require('../middleware/auth');

function createScriptConstraintPromptsRouter({ promptStore } = {}) {
  if (!promptStore) throw new Error('promptStore is required');
  const router = express.Router();
  // Prompt records are owned by the authenticated user; this router must never
  // be mounted without apiAuth.
  router.use(apiAuth);
  function invalid(res) { return res.status(400).json({ error: '提示词参数无效' }); }
  function missing(res) { return res.status(404).json({ error: '提示词不存在' }); }
  router.get('/', (req, res) => {
    try { res.json({ prompts: promptStore.list(req.username, req.query.category) }); } catch { invalid(res); }
  });
  router.post('/', (req, res) => {
    try {
      const prompt = promptStore.createOrSaveDraft(req.username, { category: req.body?.category, name: req.body?.name === null ? null : req.body?.name, body: req.body?.body });
      res.status(201).json({ prompt });
    } catch { invalid(res); }
  });
  router.put('/:id', (req, res) => {
    try { const prompt = promptStore.update(req.username, req.params.id, req.body || {}); if (!prompt) return missing(res); res.json({ prompt }); } catch { invalid(res); }
  });
  router.delete('/:id', (req, res) => { try { if (!promptStore.remove(req.username, req.params.id)) return missing(res); res.status(204).end(); } catch { missing(res); } });
  router.post('/usage', (req, res) => { try { promptStore.markUsed(req.username, req.body?.ids); res.status(200).json({ ok: true }); } catch { invalid(res); } });
  return router;
}

module.exports = { createScriptConstraintPromptsRouter };
