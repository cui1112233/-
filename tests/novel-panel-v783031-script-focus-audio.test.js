const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { SYSTEM_PRESETS } = require('../lib/system-preset-catalog');

const page = fs.readFileSync('frontend/src/user/pages/ScriptPage.jsx', 'utf8');
const route = fs.readFileSync('routes/prompt.js', 'utf8');
const frontendRules = fs.readFileSync('frontend/src/user/pages/scriptGenerationRules.js', 'utf8');

function preset(id) {
  return SYSTEM_PRESETS.find(item => item.id === id);
}

test('starred characters are an editable focus variable, never an automatic protagonist identity', () => {
  const focus = preset('script-character-focus');
  assert.ok(focus, 'script-character-focus must be registered in the backend preset catalog');
  assert.equal(focus.name, '星标人物聚焦规则');
  assert.match(focus.body, /剧情聚焦变量/);
  assert.match(focus.body, /\{focusCharacters\}/);
  assert.match(focus.body, /不得创造原文不存在的冲突/);
  assert.match(route, /resolveSystemPresetBody\(presetStore,\s*['"]script-character-focus['"]\)/);
  assert.doesNotMatch(route, /为男主角、/);
  assert.doesNotMatch(route, /为女主角展开剧情/);
  assert.doesNotMatch(page, /selectDefaultProtagonistIds/);
});

test('match audio is a backend-editable rule injected into normal script generation', () => {
  const audio = preset('script-audio-match');
  assert.ok(audio, 'script-audio-match must be registered in the backend preset catalog');
  assert.equal(audio.name, '匹配音频规则');
  assert.match(audio.body, /\{audioDurationSec\}/);
  assert.match(audio.body, /\{unitMaxSec\}/);
  assert.match(audio.body, /时长总和/);
  assert.match(route, /resolveSystemPresetBody\(presetStore,\s*['"]script-audio-match['"]\)/);
  assert.match(route, /audioMatchPrompt/);
  assert.match(page, /generateScript\(\{[\s\S]*?matchAudio:\s*quickDirectorOptions\.matchAudio[\s\S]*?audioTotalSeconds:/);
});

test('match-audio UI is only a generation setting and no longer exposes quick-director description modes', () => {
  assert.match(page, /匹配音频设置/);
  assert.doesNotMatch(page, /画面描述模式/);
  assert.doesNotMatch(page, /descriptionMode/);
  assert.doesNotMatch(page, /generateQuickDirectorStoryboard/);
  assert.doesNotMatch(page, /quickDirectorStoryboard/);
});

test('normal match-audio path preserves the actual audio duration to hundredths instead of ceiling to an integer', () => {
  assert.doesNotMatch(frontendRules, /Math\.ceil\(parsed\)/);
  assert.match(frontendRules, /Math\.round\(parsed\s*\*\s*100\)\s*\/\s*100/);
});
