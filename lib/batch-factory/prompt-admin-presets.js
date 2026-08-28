const fs = require('node:fs');
const path = require('node:path');
const {
  SCRIPT_PROMPTS,
  ASSET_PROMPTS,
  resolveScriptPrompt,
  resolveAssetPrompt
} = require('./prompt-selection');

const promptsDir = path.join(__dirname, '..', '..', 'prompts');
const MAINTENANCE_PROMPTS = [
  ['batch-asset-regenerate', '单资产重生', '批量工厂-资产重生.md', 'asset-regenerate', '批量工厂当前小说内单个人物、场景或道具提示词重生规则'],
  ['batch-video-regenerate', '单分镜重生', '批量工厂-单分镜重生.md', 'video-regenerate', '批量工厂当前小说内单个 VIDEO 分镜重生规则']
];

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
    protocolLock: { format: 'batch-factory-preset', category, source: definition.file }
  });
  store.publish(actor, draft.id, draft.version);
}

function seedMaintenance(store, actor, definition) {
  const [id, name, file, operation, description] = definition;
  if (store.listAll('batch-factory').some(existing => existing.id === id)) return;
  const draft = store.createDraft(actor, {
    id,
    module: 'batch-factory',
    name,
    kind: 'base',
    description,
    compatibleBaseIds: [],
    body: fs.readFileSync(path.join(promptsDir, file), 'utf8').trim(),
    protocolLock: { format: 'batch-factory-maintenance', operation, source: file }
  });
  store.publish(actor, draft.id, draft.version);
}

function seedBatchFactoryPromptPresets(store, actor) {
  for (const definition of Object.values(SCRIPT_PROMPTS)) seedOne(store, actor, definition, 'script', resolveScriptPrompt);
  for (const definition of Object.values(ASSET_PROMPTS)) seedOne(store, actor, definition, 'asset', resolveAssetPrompt);
  for (const definition of MAINTENANCE_PROMPTS) seedMaintenance(store, actor, definition);
}

module.exports = { seedBatchFactoryPromptPresets, MAINTENANCE_PROMPTS };
