const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { createUserPromptLibraryStore } = require('../lib/user-prompt-library-store');
const {
  setBatchFactoryPresetStore,
  resolveScriptPrompt,
  resolveAssetPrompt,
  publicPromptCatalog
} = require('../lib/batch-factory/prompt-selection');

function catalogDefinition(promptId) {
  const catalog = publicPromptCatalog();
  const script = catalog.scriptPrompts.find(item => item.id === promptId);
  if (script) return { ...script, category: 'script' };
  const asset = catalog.assetPrompts.find(item => item.id === promptId);
  if (asset) return { ...asset, category: 'asset' };
  return null;
}

function systemPrompt(def) {
  return def.category === 'script' ? resolveScriptPrompt(def.id) : resolveAssetPrompt(def.id);
}

function effectivePrompt(store, username, def) {
  const base = systemPrompt(def);
  const override = store.get(username, def.id);
  return {
    id: def.id,
    name: base.name || def.name,
    category: def.category,
    body: override?.body || base.body,
    source: override ? 'personal' : 'system',
    customized: Boolean(override),
    personalVersion: override?.version || 0,
    systemVersion: base.version || 1,
    updatedAt: override?.updatedAt || ''
  };
}

function createUserPromptLibraryRouter({ store = createUserPromptLibraryStore(), presetStore } = {}) {
  setBatchFactoryPresetStore(presetStore);
  const router = express.Router();
  router.use(apiAuth);

  router.get('/batch-factory', (req, res) => {
    const catalog = publicPromptCatalog();
    const scriptPrompts = catalog.scriptPrompts.map(def => effectivePrompt(store, req.username, { ...def, category: 'script' }));
    const assetPrompts = catalog.assetPrompts.map(def => effectivePrompt(store, req.username, { ...def, category: 'asset' }));
    res.json({
      module: 'batch-factory',
      name: '批量工厂',
      scriptPrompts,
      assetPrompts
    });
  });

  router.put('/batch-factory/:promptId', (req, res) => {
    const def = catalogDefinition(req.params.promptId);
    if (!def) return res.status(404).json({ error: '提示词不存在或尚未发布' });
    try {
      store.save(req.username, def.id, req.body?.body);
      return res.json({ prompt: effectivePrompt(store, req.username, def) });
    } catch (error) {
      return res.status(400).json({ error: error.message || '保存提示词失败' });
    }
  });

  router.post('/batch-factory/:promptId/reset', (req, res) => {
    const def = catalogDefinition(req.params.promptId);
    if (!def) return res.status(404).json({ error: '提示词不存在或尚未发布' });
    store.reset(req.username, def.id);
    return res.json({ prompt: effectivePrompt(store, req.username, def) });
  });

  return router;
}

module.exports = { createUserPromptLibraryRouter };
