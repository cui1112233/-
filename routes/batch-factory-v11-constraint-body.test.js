const test = require('node:test');
const assert = require('node:assert/strict');

const {
  automationSettingsWithResolvedConstraintBodies,
  automationCompilePayload
} = require('./batch-factory-v11');

const RESTRICTION_ID = 'script-constraint-restriction-h3-visual-policy';
const NEGATIVE_ID = 'script-constraint-negative-sd-detail';

function presetStoreWith(presets) {
  return { getPublished: id => presets[id] || null };
}

const restrictionPreset = {
  id: RESTRICTION_ID,
  module: 'script',
  kind: 'addon',
  version: 1,
  name: 'H3 画面限制',
  body: '不要出现现代物品与字幕水印',
  protocolLock: { format: 'constraint', category: 'restriction', slot: 'script.constraint.restriction' }
};
const negativePreset = {
  id: NEGATIVE_ID,
  module: 'script',
  kind: 'addon',
  version: 1,
  name: 'SD 最终导出负面提示词',
  body: '低清、畸形手指、多余肢体',
  protocolLock: { format: 'constraint', category: 'negative', slot: 'script.constraint.negative' }
};

function settingsWith(selections, enabledCategories = ['restriction', 'negative']) {
  return {
    aiPromptConfig: {
      video: { presetKey: 'h3-video-normal', presetVersion: 1, body: '模板\n{{storyboard}}' },
      constraints: { enabled: true, enabledCategories, selections }
    }
  };
}

test('director compilation backfills missing published constraint bodies by presetId and category', () => {
  const settings = settingsWith([
    { constraintCategory: 'restriction', presetId: RESTRICTION_ID },
    { constraintCategory: 'negative', presetId: NEGATIVE_ID }
  ]);
  const resolved = automationSettingsWithResolvedConstraintBodies(settings, presetStoreWith({
    [RESTRICTION_ID]: restrictionPreset,
    [NEGATIVE_ID]: negativePreset
  }));
  const byCategory = Object.fromEntries(resolved.aiPromptConfig.constraints.selections.map(item => [item.constraintCategory, item]));
  assert.equal(byCategory.restriction.body, '不要出现现代物品与字幕水印');
  assert.equal(byCategory.negative.body, '低清、畸形手指、多余肢体');

  const payload = automationCompilePayload({ directorRevision: { id: 'd1' } }, resolved);
  assert.equal(payload.visual_restriction_text, '不要出现现代物品与字幕水印');
  assert.equal(payload.negative_text, '低清、畸形手指、多余肢体');
});

test('backfill never overwrites an existing non-empty body (personal prompt or draft)', () => {
  const settings = settingsWith([
    { constraintCategory: 'restriction', presetId: RESTRICTION_ID, body: '我自己改过的画面限制' }
  ]);
  const resolved = automationSettingsWithResolvedConstraintBodies(settings, presetStoreWith({ [RESTRICTION_ID]: restrictionPreset }));
  assert.equal(
    resolved.aiPromptConfig.constraints.selections.find(item => item.constraintCategory === 'restriction').body,
    '我自己改过的画面限制'
  );
});

test('backfill ignores preset whose constraint category does not match the layer', () => {
  const settings = settingsWith([{ constraintCategory: 'quality', presetId: RESTRICTION_ID }], ['quality']);
  const resolved = automationSettingsWithResolvedConstraintBodies(settings, presetStoreWith({ [RESTRICTION_ID]: restrictionPreset }));
  assert.equal(
    resolved.aiPromptConfig.constraints.selections.find(item => item.constraintCategory === 'quality').body,
    undefined
  );
});

test('backfill is a no-op without a preset store or selections and does not mutate the input', () => {
  const settings = settingsWith([{ constraintCategory: 'restriction', presetId: RESTRICTION_ID }]);
  const snapshot = JSON.parse(JSON.stringify(settings));
  const withoutStore = automationSettingsWithResolvedConstraintBodies(settings, null);
  assert.equal(withoutStore, settings);
  assert.deepEqual(settings, snapshot);

  const noSelections = { aiPromptConfig: { constraints: { enabled: true } } };
  assert.equal(automationSettingsWithResolvedConstraintBodies(noSelections, presetStoreWith({ [RESTRICTION_ID]: restrictionPreset })), noSelections);
});
