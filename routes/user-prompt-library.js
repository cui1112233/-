const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { createUserPromptLibraryStore } = require('../lib/user-prompt-library-store');
const {
  SCRIPT_PROMPTS,
  ASSET_PROMPTS,
  resolveScriptPrompt,
  resolveAssetPrompt
} = require('../lib/batch-factory/prompt-selection');

function definition(promptId) {
  if (SCRIPT_PROMPTS[promptId]) return { ...SCRIPT_PROMPTS[promptId], category: 'script' };
  if (ASSET_PROMPTS[promptId]) return { ...ASSET_PROMPTS[promptId], category: 'asset' };
  return null;
}

function effectivePrompt(store, username, def) {
  const base = def.category === 'script' ? resolveScriptPrompt(def.id) : resolveAssetPrompt(def.id);
  const override = store.get(username, def.id);
  return {
    id: def.id,
    name: def.name,
    category: def.category,
    body: override?.body || base.body,
    source: override ? 'personal' : 'system',
    customized: Boolean(override),
    personalVersion: override?.version || 0,
    systemVersion: base.version || 1,
    updatedAt: override?.updatedAt || ''
  };
}

function createUserPromptLibraryRouter({ store = createUserPromptLibraryStore() } = {}) {
  const router = express.Router();
  router.use(apiAuth);

  router.get('/batch-factory', (req, res) => {
    const scriptPrompts = Object.values(SCRIPT_PROMPTS).map(def => effectivePrompt(store, req.username, { ...def, category: 'script' }));
    const assetPrompts = Object.values(ASSET_PROMPTS).map(def => effectivePrompt(store, req.username, { ...def, category: 'asset' }));
    res.json({
      module: 'batch-factory',
      name: '批量工厂',
      scriptPrompts,
      assetPrompts
    });
  });

  router.put('/batch-factory/:promptId', (req, res) => {
    const def = definition(req.params.promptId);
    if (!def) return res.status(404).json({ error: '提示词不存在' });
    try {
      store.save(req.username, def.id, req.body?.body);
      return res.json({ prompt: effectivePrompt(store, req.username, def) });
    } catch (error) {
      return res.status(400).json({ error: error.message || '保存提示词失败' });
    }
  });

  router.post('/batch-factory/:promptId/reset', (req, res) => {
    const def = definition(req.params.promptId);
    if (!def) return res.status(404).json({ error: '提示词不存在' });
    store.reset(req.username, def.id);
    return res.json({ prompt: effectivePrompt(store, req.username, def) });
  });

  return router;
}

module.exports = { createUserPromptLibraryRouter };
