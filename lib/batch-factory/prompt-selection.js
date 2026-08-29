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

function isCategoryPreset(item, category) {
  const format = item?.protocolLock?.format;
  return ['batch-factory-preset', 'batch-factory-user-prompt'].includes(format)
    && item?.protocolLock?.category === category;
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

function allByCategory(category, store = presetStore) {
  if (!store?.listAll) return [];
  return store.listAll('batch-factory')
    .filter(item => isCategoryPreset(item, category));
}

function publishedByCategory(category, store = presetStore) {
  return allByCategory(category, store)
    .filter(item => item.status === 'published')
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

function resolvePrompt(id, category, fallbacks, store = presetStore, version = null) {
  const definition = fallbacks[id] || Object.values(fallbacks)[0];
  if (store && Number.isInteger(Number(version)) && Number(version) > 0 && store.getVersion) {
    const pinned = store.getVersion(definition.id, Number(version));
    if (pinned && isCategoryPreset(pinned, category)) {
      return {
        id: pinned.id,
        name: pinned.name,
        body: String(pinned.body || '').trim(),
        version: Number(pinned.version || 1),
        category,
        source: 'system'
      };
    }
  }
  const published = publishedByCategory(category, store);
  const selected = published.find(item => item.id === definition.id);
  return selected || fallbackPrompt(definition);
}

function resolveScriptPrompt(id, store = presetStore, version = null) {
  return resolvePrompt(id, 'script', SCRIPT_PROMPTS, store, version);
}

function resolveAssetPrompt(id, store = presetStore, version = null) {
  return resolvePrompt(id, 'asset', ASSET_PROMPTS, store, version);
}

function catalogCategory(category, fallbacks, store = presetStore) {
  const published = publishedByCategory(category, store);
  const all = allByCategory(category, store);
  const definitions = Object.values(fallbacks);
  return definitions
    .map(definition => {
      const current = published.find(item => item.id === definition.id) || fallbackPrompt(definition);
      const versions = all
        .filter(item => item.id === definition.id && ['published', 'archived'].includes(item.status))
        .sort((left, right) => Number(right.version) - Number(left.version))
        .map(item => ({
          version: Number(item.version),
          status: item.status,
          publishedAt: item.publishedAt || ''
        }));
      if (!versions.length) versions.push({ version: 1, status: 'published', publishedAt: '' });
      return {
        id: current.id,
        name: current.name,
        version: current.version,
        versions
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function publicPromptCatalog(store = presetStore) {
  return {
    scriptPrompts: catalogCategory('script', SCRIPT_PROMPTS, store),
    assetPrompts: catalogCategory('asset', ASSET_PROMPTS, store)
  };
}

module.exports = {
  SCRIPT_PROMPTS,
  ASSET_PROMPTS,
  setBatchFactoryPresetStore,
  resolveScriptPrompt,
  resolveAssetPrompt,
  publicPromptCatalog,
  isCategoryPreset
};
