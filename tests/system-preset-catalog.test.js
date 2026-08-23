const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createPresetStore } = require('../lib/preset-store');
const {
  seedSystemPresets,
  resolveSystemPresetBody,
  validatePresetSlot,
  listPublishedForSlot
} = require('../lib/system-preset-catalog');
const chatRouter = require('../routes/chat');
const novelPanelRouter = require('../routes/novel-panel');

function createStore(t) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-system-presets-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  return createPresetStore({ systemDir });
}

function createSlotStore(t) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-system-preset-slots-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  return createPresetStore({ systemDir, validatePresetSlot });
}

test('published presets are listed only in their compatible ownership slot', t => {
  const store = createSlotStore(t);
  seedSystemPresets(store, 'owner');

  const custom = store.createDraft('owner', {
    id: 'shuihuo-character-custom',
    module: 'shuihuo-production',
    name: '人物提取增强',
    kind: 'base',
    description: '人物资产提取规则',
    compatibleBaseIds: [],
    body: 'CUSTOM_CHARACTER_EXTRACTION',
    protocolLock: { format: 'json', slot: 'shuihuo.asset.character-extraction' }
  });
  store.publish('owner', custom.id, custom.version);

  assert.deepEqual(
    listPublishedForSlot(store, 'shuihuo.asset.character-extraction').map(item => item.id),
    ['shuihuo-character-custom', 'shuihuo-extract-characters']
  );
  assert.throws(() => store.createDraft('owner', {
    id: 'wrong-slot',
    module: 'shuihuo-production',
    name: '错误归属',
    kind: 'base',
    description: '',
    compatibleBaseIds: [],
    body: 'x',
    protocolLock: { slot: 'novel.analysis' }
  }), /Invalid preset draft/);
  assert.throws(() => store.createDraft('owner', {
    id: 'slot-addon',
    module: 'shuihuo-production',
    name: '错误类型',
    kind: 'addon',
    description: '',
    compatibleBaseIds: [],
    body: 'x',
    protocolLock: { slot: 'shuihuo.asset.character-extraction' }
  }), /Invalid preset draft/);
});

test('slot-owned addons cannot be resolved with a base from another slot', t => {
  const store = createSlotStore(t);
  const base = store.createDraft('owner', {
    id: 'script-slot-base',
    module: 'script',
    name: '剧本提取',
    kind: 'base',
    description: '',
    compatibleBaseIds: [],
    body: 'BASE',
    protocolLock: { slot: 'script.extract' }
  });
  const addon = store.createDraft('owner', {
    id: 'script-slot-addon',
    module: 'script',
    name: '画面前缀',
    kind: 'addon',
    description: '',
    compatibleBaseIds: ['script-slot-base'],
    body: 'ADDON',
    protocolLock: { slot: 'script.constraint.prefix' }
  });
  store.publish('owner', base.id, base.version);
  store.publish('owner', addon.id, addon.version);

  assert.throws(() => store.resolveSelection({
    module: 'script',
    presetIds: [base.id, addon.id]
  }), /same ownership slot/i);
});

test('public summaries expose a null slot for legacy presets', t => {
  const store = createStore(t);
  const legacy = store.createDraft('owner', {
    id: 'legacy-preset',
    module: 'novel-panel',
    name: '旧提示词',
    kind: 'base',
    description: '',
    compatibleBaseIds: [],
    body: 'LEGACY_BODY',
    protocolLock: { format: 'json' }
  });

  assert.equal(legacy.slot, null);
});

test('legacy presets without an ownership slot cannot be published by a validated store', t => {
  const legacyStore = createStore(t);
  const legacy = legacyStore.createDraft('owner', {
    id: 'legacy-unassigned',
    module: 'novel-panel',
    name: '旧提示词',
    kind: 'base',
    description: '',
    compatibleBaseIds: [],
    body: 'LEGACY_BODY',
    protocolLock: { format: 'json' }
  });
  const strictStore = createPresetStore({
    systemDir: path.dirname(legacyStore.files.presets),
    validatePresetSlot
  });

  assert.throws(() => strictStore.publish('owner', legacy.id, legacy.version), /ownership slot/i);
});

test('legacy presets without an ownership slot cannot be rolled back into publication', t => {
  const legacyStore = createStore(t);
  const legacy = legacyStore.createDraft('owner', {
    id: 'legacy-rollback', module: 'novel-panel', name: '旧提示词', kind: 'base',
    description: '', compatibleBaseIds: [], body: 'LEGACY_BODY', protocolLock: { format: 'json' }
  });
  legacyStore.publish('owner', legacy.id, legacy.version);
  const strictStore = createPresetStore({ systemDir: path.dirname(legacyStore.files.presets), validatePresetSlot });
  const replacement = strictStore.createDraft('owner', {
    id: legacy.id, module: 'novel-panel', name: '已归属提示词', kind: 'base',
    description: '', compatibleBaseIds: [], body: 'CURRENT_BODY', protocolLock: { slot: 'novel.analysis' }
  });
  strictStore.publish('owner', replacement.id, replacement.version);

  assert.throws(() => strictStore.rollback('owner', legacy.id, legacy.version), /before rollback/i);
});

test('seeds fixed server-only defaults once without overwriting a published edit', t => {
  const store = createStore(t);

  seedSystemPresets(store, 'owner');
  assert.equal(store.listAll('script').length, 26);
  assert.equal(store.getPublished('script-quick-director-storyboard').protocolLock.slot, 'script.quick-director');
  assert.equal(store.getPublished('script-format-q版').protocolLock.slot, 'script.format.q版');
  assert.equal(store.listAll('novel-panel').length, 3);
  assert.deepEqual(
    store.listAll('shuihuo-production').map(preset => preset.name).sort(),
    [
      '人物场景、道具提取', '提取人物', '提取场景', '提取道具', '分镜资产绑定', '智能识别',
      '画面提示词', '视频提示词', '负面提示词', '配色图人物设计', '三视图配饰设计',
      '三视图', '角色表情多状态', '单视图'
    ].sort()
  );

  assert.equal(store.getPublished('shuihuo-extract-props').protocolLock.slot, 'shuihuo.asset.prop-extraction');
  assert.equal(store.getPublished('shuihuo-asset-binding').protocolLock.slot, 'shuihuo.asset.binding');
  for (const id of [
    'shuihuo-character-color-sheet',
    'shuihuo-character-accessory-sheet',
    'shuihuo-character-three-view',
    'shuihuo-character-expression-sheet',
    'shuihuo-character-single-view'
  ]) {
    assert.equal(store.getPublished(id).protocolLock.slot, 'shuihuo.asset.character-sheet');
  }

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

test('upgrades a legacy water-production smart preset slot without replacing its published metadata', t => {
  const store = createStore(t);
  const legacy = store.createDraft('owner', {
    id: 'shuihuo-smart-segmentation',
    module: 'shuihuo-production',
    name: '智能识别',
    kind: 'base',
    description: '旧说明',
    compatibleBaseIds: [],
    body: 'PRESERVE_CUSTOM_PUBLISHED_BODY',
    protocolLock: { format: 'json', operation: 'segmentation' }
  });
  store.publish('owner', legacy.id, legacy.version);

  seedSystemPresets(store, 'owner');

  const published = store.getPublished('shuihuo-smart-segmentation');
  assert.equal(published.name, '智能识别');
  assert.equal(published.body, 'PRESERVE_CUSTOM_PUBLISHED_BODY');
  assert.equal(published.version, 2);
});

test('seeded smart segmentation requires a speaker for every storyboard candidate', t => {
  const store = createStore(t);
  seedSystemPresets(store, 'owner');

  const preset = store.getPublished('shuihuo-smart-segmentation');
  assert.match(preset.body, /"speaker"/);
  assert.match(preset.body, /连续台词/);
  assert.match(preset.body, /叙述与台词/);
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

test('a published module add-on without a slot is excluded from system prompt resolution', t => {
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
  assert.doesNotMatch(resolveSystemPresetBody(store, 'script-extract'), /GLOBAL_SCRIPT_ADDON/);
  assert.doesNotMatch(resolveSystemPresetBody(store, 'script-hook'), /GLOBAL_SCRIPT_ADDON/);
});

test('admin frontend exposes the protected system preset library controls', () => {
  const root = path.resolve(__dirname, '..');
  const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

  assert.match(read('frontend/src/admin/App.jsx'), /pathname === '\/admin\/presets'/);
  assert.match(read('frontend/src/shared/layouts/AdminLayout.jsx'), /href: '\/admin\/presets'/);
  const adminApi = read('frontend/src/shared/api/admin.js');
  assert.match(adminApi, /const base = '\/api\/admin'/);
  assert.match(adminApi, /\$\{base\}\/presets/);
  assert.match(adminApi, /listAdminPresetSlots/);
  const page = read('frontend/src/admin/pages/PresetLibraryPage.jsx');
  assert.match(page, /createPresetDraft/);
  assert.match(page, /publishPreset/);
  assert.match(page, /rollbackPreset/);
  assert.match(page, /Input\.TextArea/);
  assert.match(page, /归属/);
  assert.match(page, /待设置归属/);
  assert.match(page, /listAdminPresetSlots/);
  assert.match(page, /name="slot"/);
});
