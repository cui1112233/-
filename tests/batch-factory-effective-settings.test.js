const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveItemSettings } = require('../lib/batch-factory/effective-settings');

test('current novel only overrides constraint fields it actually changes', () => {
  const batch = {
    settings: {
      customPrefix: '3D国漫',
      quality: '电影级灯光',
      restriction: '禁止字幕',
      negative: '畸形手指',
      constraintPrefixEnabled: true,
      constraintQualityEnabled: true,
      constraintRestrictionEnabled: false,
      constraintNegativeEnabled: true,
      injectCharacterPrompt: true,
      injectScenePrompt: true
    }
  };
  const item = {
    settingsOverride: {
      constraintRestrictionEnabled: true,
      restriction: '禁止字幕、禁止水印'
    }
  };

  const resolved = resolveItemSettings(batch, item);
  assert.equal(resolved.customPrefix, '3D国漫');
  assert.equal(resolved.quality, '电影级灯光');
  assert.equal(resolved.negative, '畸形手指');
  assert.equal(resolved.constraintPrefixEnabled, true);
  assert.equal(resolved.constraintQualityEnabled, true);
  assert.equal(resolved.constraintNegativeEnabled, true);
  assert.equal(resolved.constraintRestrictionEnabled, true);
  assert.equal(resolved.restriction, '禁止字幕、禁止水印');
});

test('current novel can turn inherited base people and scene injection off without deleting batch values', () => {
  const batch = { settings: { injectCharacterPrompt: true, injectScenePrompt: true, injectPropPrompt: true } };
  const item = { settingsOverride: { injectCharacterPrompt: false, injectScenePrompt: false } };
  const resolved = resolveItemSettings(batch, item);

  assert.equal(resolved.injectCharacterPrompt, false);
  assert.equal(resolved.injectScenePrompt, false);
  assert.equal(resolved.injectPropPrompt, true);
  assert.equal(batch.settings.injectCharacterPrompt, true);
  assert.equal(batch.settings.injectScenePrompt, true);
});
