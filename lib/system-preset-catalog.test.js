const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BATCH_FACTORY_PRESET_REQUIREMENTS,
  isPublishedPresetAllowed,
  listPublishedForSlot,
  seedSystemPresets,
  SYSTEM_PRESETS
} = require('./system-preset-catalog');

test('Batch Factory extraction accepts only the combined people-scene-prop preset', () => {
  assert.equal(isPublishedPresetAllowed(
    { id: 'script-extract-assets', module: 'script', kind: 'base', extractionPreset: true, protocolLock: { format: 'extract', slot: 'script.asset-extraction' } },
    BATCH_FACTORY_PRESET_REQUIREMENTS['assets.extraction']
  ), true);
  assert.equal(isPublishedPresetAllowed(
    { id: 'script-extract', module: 'script', kind: 'base', extractionPreset: true, protocolLock: { format: 'extract', slot: 'script.extract' } },
    BATCH_FACTORY_PRESET_REQUIREMENTS['assets.extraction']
  ), false);
});

test('Batch Factory exposes separate character and scene renderers while prop remains a combined extraction output', () => {
	assert.deepEqual(BATCH_FACTORY_PRESET_REQUIREMENTS['assets.character'], { module: 'batch-factory', kind: 'base', slot: 'batch.character-meta' });
	assert.deepEqual(BATCH_FACTORY_PRESET_REQUIREMENTS['assets.scene'], { module: 'batch-factory', kind: 'base', slot: 'batch.scene-meta' });
	assert.equal(BATCH_FACTORY_PRESET_REQUIREMENTS['assets.prop'], undefined);
});

test('Batch Factory provides one combined people-scene-prop extraction preset', () => {
  const combined = SYSTEM_PRESETS.find(preset => preset.id === 'script-extract-assets');
  assert.equal(combined?.protocolLock?.slot, 'script.asset-extraction');
  assert.equal(combined?.protocolLock?.format, 'extract');
  assert.match(combined?.body || '', /人物场景道具统一提取/);
});

test('Batch Factory storyboard meta default contains the full script segmented-opening and shotlist bodies', () => {
  const storyboard = SYSTEM_PRESETS.find(preset => preset.id === 'batch-video-meta');
  assert.match(storyboard?.body || '', /## 剧本生成预设：分段开头/);
  assert.match(storyboard?.body || '', /先全文理解，再开始分段/);
  assert.match(storyboard?.body || '', /## 剧本生成预设：分镜模式/);
  assert.match(storyboard?.body || '', /每条画面的完整导演信息/);
  assert.match(storyboard?.body || '', /Batch Factory V11 JSON 输出适配/);
  assert.doesNotMatch(storyboard?.body || '', /^你负责把导演结果组织成可执行的视频分镜描述/);
});

test('Batch Factory publishes the H3 director VIDEO renderer as a selectable video preset', () => {
	const h3 = SYSTEM_PRESETS.find(preset => preset.id === 'batch-video-h3-director');
	assert.equal(h3?.protocolLock?.slot, 'batch.video-meta');
	assert.equal(h3?.protocolLock?.key, 'h3-video-normal');
	assert.match(h3?.body || '', /Scene Memory/);
});

test('Batch Factory publishes H3 character and scene renderers in the existing asset selector slots', () => {
	const character = SYSTEM_PRESETS.find(preset => preset.id === 'batch-character-h3');
	const scene = SYSTEM_PRESETS.find(preset => preset.id === 'batch-scene-h3');
	assert.equal(character?.protocolLock?.slot, 'batch.character-meta');
	assert.equal(character?.protocolLock?.key, 'h3-character-normal');
	assert.match(character?.body || '', /逐人物/);
	assert.equal(scene?.protocolLock?.slot, 'batch.scene-meta');
	assert.equal(scene?.protocolLock?.key, 'h3-scene-normal');
	assert.match(scene?.body || '', /Scene Memory/);
});

test('Batch Factory extraction lists every published combined asset preset in its dedicated slot', () => {
  const records = [
    { id: 'script-extract-assets', name: '默认统一提取', module: 'script', kind: 'base', status: 'published', version: 2, protocolLock: { slot: 'script.asset-extraction', format: 'extract' } },
    { id: 'script-extract-assets-female', name: '女频统一提取', module: 'script', kind: 'base', status: 'published', version: 1, protocolLock: { slot: 'script.asset-extraction', format: 'extract' } },
    { id: 'script-extract', name: '人物场景提取', module: 'script', kind: 'base', status: 'published', version: 3, protocolLock: { slot: 'script.extract', format: 'extract' } }
  ];
  const listed = listPublishedForSlot({ listAll: () => records }, 'script.asset-extraction');
  assert.deepEqual(listed.map(item => item.id), ['script-extract-assets', 'script-extract-assets-female']);
});

test('Batch Factory constraint selections accept only published script constraint slots', () => {
  const constraint = { module: 'script', kind: 'addon', protocolLock: { format: 'constraint', slot: 'script.constraint.quality' } };
  assert.equal(isPublishedPresetAllowed(constraint, BATCH_FACTORY_PRESET_REQUIREMENTS.constraints), true);
  assert.equal(isPublishedPresetAllowed({ ...constraint, kind: 'base' }, BATCH_FACTORY_PRESET_REQUIREMENTS.constraints), false);
});

test('seeding upgrades the untouched legacy Batch Factory video body to the complete script-preset composition', () => {
  const published = new Map([['batch-video-meta', {
    id: 'batch-video-meta', module: 'batch-factory', name: '视频提示词元提示词', kind: 'base',
    description: '批量工厂视频单元、镜头与整数时间轴规则', compatibleBaseIds: [], body: '你负责把导演结果组织成可执行的视频分镜描述。\n\n规则：旧版默认正文',
    protocolLock: { slot: 'batch.video-meta' }, version: 1, status: 'published'
  }]]);
  const drafts = new Map();
  const store = {
    getPublished: id => published.get(id) || null,
    createDraft: (_, input) => { const draft = { ...input, version: (published.get(input.id)?.version || 0) + 1 }; drafts.set(input.id, draft); return { id: draft.id, version: draft.version }; },
    publish: (_, id) => { published.set(id, { ...drafts.get(id), status: 'published' }); return published.get(id); }
  };
  seedSystemPresets(store, 'choushiyiguai');
  const upgraded = published.get('batch-video-meta');
  const body = upgraded.body;
  assert.equal(upgraded.name, '分镜元提示词（自动组合）');
  assert.equal(upgraded.description, '自动组合剧本生成的分段开头与分镜模式；批量工厂只保留 JSON 分镜输出协议');
  assert.match(body, /剧本生成预设：分段开头/);
  assert.match(body, /剧本生成预设：分镜模式/);
  assert.match(body, /Batch Factory V11 JSON 输出适配/);
  assert.doesNotMatch(body, /旧版默认正文/);
});
