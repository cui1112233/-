const fs = require('node:fs');
const path = require('node:path');

const promptsDir = path.join(__dirname, '..', '..', 'prompts');
const SYSTEM_ACTOR = 'choushiyiguai';

const SCRIPT_PROMPTS = Object.freeze({
  'standard-short-drama': {
    id: 'standard-short-drama',
    name: '标准短剧分镜',
    file: '批量工厂-标准短剧分镜.md',
    category: 'script'
  },
  'commercial-dynamic-storyboard': {
    id: 'commercial-dynamic-storyboard',
    name: '商业动态分镜',
    file: '批量工厂-商业动态分镜.md',
    category: 'script'
  },
  'spatial-continuity-storyboard': {
    id: 'spatial-continuity-storyboard',
    name: '空间连续分镜',
    file: '批量工厂-空间连续分镜.md',
    category: 'script'
  }
});

const ASSET_PROMPTS = Object.freeze({
  'standard-asset-extraction': {
    id: 'standard-asset-extraction',
    name: '标准资产提取',
    file: '批量工厂-标准资产提取.md',
    category: 'asset'
  }
});

let presetStore = null;

function fileBody(definition) {
  return fs.readFileSync(path.join(promptsDir, definition.file), 'utf8').trim();
}

function protocolLock(category) {
  return { format: 'batch-factory-preset', category };
}

function seedDefinition(store, definition) {
  if (!store || !definition) return;
  const existing = store.listAll('batch-factory').some(item => item.id === definition.id);
  if (existing) return;
  const draft = store.createDraft(SYSTEM_ACTOR, {
    id: definition.id,
    module: 'batch-factory',
    name: definition.name,
    kind: 'base',
    description: definition.category === 'script' ? '批量工厂用户可选剧本提示词' : '批量工厂用户可选人物场景提示词',
    compatibleBaseIds: [],
    body: fileBody(definition),
    protocolLock: protocolLock(definition.category)
  });
  store.publish(SYSTEM_ACTOR, draft.id, draft.version);
}

function setBatchFactoryPresetStore(store) {
  presetStore = store || null;
  if (!presetStore) return;
  for (const definition of Object.values(SCRIPT_PROMPTS)) seedDefinition(presetStore, definition);
  for (const definition of Object.values(ASSET_PROMPTS)) seedDefinition(presetStore, definition);
}

function publishedByCategory(category) {
  if (!presetStore) return [];
  return presetStore.listAll('batch-factory')
    .filter(item => item.status === 'published')
    .filter(item => item.protocolLock?.format === 'batch-factory-preset' && item.protocolLock?.category === category)
    .map(item => ({
      id: item.id,
      name: item.name,
      body: String(item.body || '').trim(),
      version: Number(item.version || 1),
      category,
      source: 'system'
    }));
}

function fallbackPrompt(definition) {
  return {
    ...definition,
    body: fileBody(definition),
    version: 1,
    source: 'system'
  };
}

function resolvePrompt(id, category, fallbacks) {
  const published = publishedByCategory(category);
  const selected = published.find(item => item.id === id);
  if (selected) return selected;
  const fallback = fallbacks[id] || Object.values(fallbacks)[0];
  const publishedFallback = published.find(item => item.id === fallback.id);
  return publishedFallback || fallbackPrompt(fallback);
}

function resolveScriptPrompt(id) {
  return resolvePrompt(id, 'script', SCRIPT_PROMPTS);
}

function resolveAssetPrompt(id) {
  return resolvePrompt(id, 'asset', ASSET_PROMPTS);
}

function catalogCategory(category, fallbacks) {
  const rows = publishedByCategory(category);
  const seen = new Set(rows.map(item => item.id));
  for (const definition of Object.values(fallbacks)) {
    if (!seen.has(definition.id)) rows.push(fallbackPrompt(definition));
  }
  return rows
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .map(({ id, name, version }) => ({ id, name, version }));
}

function publicPromptCatalog() {
  return {
    scriptPrompts: catalogCategory('script', SCRIPT_PROMPTS),
    assetPrompts: catalogCategory('asset', ASSET_PROMPTS)
  };
}

module.exports = {
  SCRIPT_PROMPTS,
  ASSET_PROMPTS,
  setBatchFactoryPresetStore,
  resolveScriptPrompt,
  resolveAssetPrompt,
  publicPromptCatalog
};
