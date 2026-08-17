const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createPresetStore } = require('../lib/preset-store');
const { seedSystemPresets, resolveSystemPresetBody } = require('../lib/system-preset-catalog');
const chatRouter = require('../routes/chat');
const novelPanelRouter = require('../routes/novel-panel');

function createStore(t) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-system-presets-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  return createPresetStore({ systemDir });
}

test('seeds the ten fixed server-only defaults once without overwriting a published edit', t => {
  const store = createStore(t);

  seedSystemPresets(store, 'owner');
  assert.equal(store.listAll('script').length, 18);
  assert.equal(store.listAll('novel-panel').length, 3);

  const original = store.getPublished('script-extract');
  const edited = store.createDraft('owner', {
    id: original.id,
    module: original.module,
    name: original.name,
    kind: original.kind,
    description: original.description,
    compatibleBaseIds: original.compatibleBaseIds,
    body: 'EDITED_SERVER_ONLY_BODY',
    protocolLock: original.protocolLock
  });
  store.publish('owner', edited.id, edited.version);

  seedSystemPresets(store, 'owner');

  assert.equal(store.getPublished('script-extract').body, 'EDITED_SERVER_ONLY_BODY');
  assert.equal(store.listAll('script').filter(preset => preset.id === 'script-extract').length, 2);
});

test('script and novel panel generation use only the current published preset body', t => {
  const store = createStore(t);
  seedSystemPresets(store, 'owner');

  const originalScript = store.getPublished('script-extract');
  const beforePublish = chatRouter._private.buildExtractMessages({ novelText: '原文' }, store);
  const scriptDraft = store.createDraft('owner', {
    id: originalScript.id,
    module: originalScript.module,
    name: originalScript.name,
    kind: originalScript.kind,
    description: originalScript.description,
    compatibleBaseIds: originalScript.compatibleBaseIds,
    body: 'NEW_EXTRACT_RULE',
    protocolLock: originalScript.protocolLock
  });
  assert.doesNotMatch(chatRouter._private.buildExtractMessages({ novelText: '原文' }, store)[0].content, /NEW_EXTRACT_RULE/);
  store.publish('owner', scriptDraft.id, scriptDraft.version);
  assert.match(chatRouter._private.buildExtractMessages({ novelText: '原文' }, store)[0].content, /NEW_EXTRACT_RULE/);

  const originalNovel = store.getPublished('novel-analysis');
  const novelDraft = store.createDraft('owner', {
    id: originalNovel.id,
    module: originalNovel.module,
    name: originalNovel.name,
    kind: originalNovel.kind,
    description: originalNovel.description,
    compatibleBaseIds: originalNovel.compatibleBaseIds,
    body: 'NEW_ANALYSIS_RULE',
    protocolLock: originalNovel.protocolLock
  });
  assert.doesNotMatch(novelPanelRouter._private.analysisSystemPrompt(store), /NEW_ANALYSIS_RULE/);
  store.publish('owner', novelDraft.id, novelDraft.version);
  assert.match(novelPanelRouter._private.analysisSystemPrompt(store), /NEW_ANALYSIS_RULE/);
});

test('extract requests use any published preset marked with the extract protocol', t => {
  const store = createStore(t);
  seedSystemPresets(store, 'owner');
  const dynamic = store.createDraft('owner', {
    id: 'script-extract-custom',
    module: 'script',
    name: '自定义提取',
    kind: 'base',
    description: '动态提取',
    compatibleBaseIds: [],
    body: 'DYNAMIC_EXTRACT_BODY',
    protocolLock: { format: 'extract' }
  });
  store.publish('owner', dynamic.id, dynamic.version);

  const messages = chatRouter._private.buildExtractMessages({ extractionPreset: dynamic.id, novelText: '原文' }, store);
  assert.match(messages[0].content, /DYNAMIC_EXTRACT_BODY/);
  assert.equal(chatRouter._private.resolveExtractionPresetId('missing', store), 'script-extract');
});

test('a published module add-on is appended automatically without exposing its body to users', t => {
  const store = createStore(t);
  seedSystemPresets(store, 'owner');
  const addon = store.createDraft('owner', {
    id: 'script-style-addon',
    module: 'script',
    name: '统一节奏补充',
    kind: 'addon',
    description: '用于所有剧本生成请求',
    compatibleBaseIds: [],
    body: 'GLOBAL_SCRIPT_ADDON',
    protocolLock: {}
  });

  assert.doesNotMatch(resolveSystemPresetBody(store, 'script-extract'), /GLOBAL_SCRIPT_ADDON/);
  store.publish('owner', addon.id, addon.version);
  assert.match(resolveSystemPresetBody(store, 'script-extract'), /GLOBAL_SCRIPT_ADDON/);
  assert.match(resolveSystemPresetBody(store, 'script-hook'), /GLOBAL_SCRIPT_ADDON/);
});

test('admin frontend exposes the protected system preset library controls', () => {
  const root = path.resolve(__dirname, '..');
  const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

  assert.match(read('frontend/src/admin/App.jsx'), /pathname === '\/admin\/presets'/);
  assert.match(read('frontend/src/shared/layouts/AdminLayout.jsx'), /href: '\/admin\/presets'/);
  const adminApi = read('frontend/src/shared/api/admin.js');
  assert.match(adminApi, /const base = '\/api\/admin'/);
  assert.match(adminApi, /\$\{base\}\/presets/);
  const page = read('frontend/src/admin/pages/PresetLibraryPage.jsx');
  assert.match(page, /createPresetDraft/);
  assert.match(page, /publishPreset/);
  assert.match(page, /rollbackPreset/);
  assert.match(page, /Input\.TextArea/);
});
