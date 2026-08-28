const fs = require('node:fs');
const path = require('node:path');

const promptsDir = path.join(__dirname, '..', '..', 'prompts');

const SCRIPT_PROMPTS = Object.freeze({
  'standard-short-drama': {
    id: 'standard-short-drama',
    name: '标准短剧分镜',
    file: '批量工厂-标准短剧分镜.md'
  },
  'commercial-dynamic-storyboard': {
    id: 'commercial-dynamic-storyboard',
    name: '商业动态分镜',
    file: '批量工厂-商业动态分镜.md'
  },
  'spatial-continuity-storyboard': {
    id: 'spatial-continuity-storyboard',
    name: '空间连续分镜',
    file: '批量工厂-空间连续分镜.md'
  }
});

const ASSET_PROMPTS = Object.freeze({
  'standard-asset-extraction': {
    id: 'standard-asset-extraction',
    name: '标准资产提取',
    file: '批量工厂-标准资产提取.md'
  }
});

function body(definition) {
  return fs.readFileSync(path.join(promptsDir, definition.file), 'utf8').trim();
}

function resolveScriptPrompt(id) {
  const definition = SCRIPT_PROMPTS[id] || SCRIPT_PROMPTS['standard-short-drama'];
  return { ...definition, body: body(definition), version: 1 };
}

function resolveAssetPrompt(id) {
  const definition = ASSET_PROMPTS[id] || ASSET_PROMPTS['standard-asset-extraction'];
  return { ...definition, body: body(definition), version: 1 };
}

function publicPromptCatalog() {
  return {
    scriptPrompts: Object.values(SCRIPT_PROMPTS).map(({ id, name }) => ({ id, name })),
    assetPrompts: Object.values(ASSET_PROMPTS).map(({ id, name }) => ({ id, name }))
  };
}

module.exports = {
  SCRIPT_PROMPTS,
  ASSET_PROMPTS,
  resolveScriptPrompt,
  resolveAssetPrompt,
  publicPromptCatalog
};
