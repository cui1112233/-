const {
  SCRIPT_PROMPTS,
  ASSET_PROMPTS,
  resolveScriptPrompt,
  resolveAssetPrompt
} = require('./prompt-selection');

function seedOne(store, actor, definition, category, resolver) {
  if (store.listAll('batch-factory').some(existing => existing.id === definition.id)) return;
  const prompt = resolver(definition.id);
  const draft = store.createDraft(actor, {
    id: definition.id,
    module: 'batch-factory',
    name: definition.name,
    kind: 'base',
    description: category === 'script'
      ? '批量工厂用户可选剧本提示词'
      : '批量工厂用户可选人物、场景、道具资产提取提示词',
    compatibleBaseIds: [],
    body: prompt.body,
    protocolLock: {
      format: 'batch-factory-preset',
      category,
      source: definition.file
    }
  });
  store.publish(actor, draft.id, draft.version);
}

function seedBatchFactoryPromptPresets(store, actor) {
  for (const definition of Object.values(SCRIPT_PROMPTS)) {
    seedOne(store, actor, definition, 'script', resolveScriptPrompt);
  }
  for (const definition of Object.values(ASSET_PROMPTS)) {
    seedOne(store, actor, definition, 'asset', resolveAssetPrompt);
  }
}

module.exports = { seedBatchFactoryPromptPresets };
