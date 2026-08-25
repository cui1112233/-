const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('settings exposes notification and CM visibility switches and layout follows pet visibility', () => {
  const settings = read('frontend/src/user/pages/SettingsPage.jsx');
  const layout = read('frontend/src/shared/layouts/UserLayout.jsx');
  assert.match(settings, /name="soundEnabled"/);
  assert.match(settings, /用于在剧本人物\/场景提取完成、剧本生成完成时提醒；提取或生成失败（如网络、404、鉴权错误）时播放警示音。/);
  assert.match(settings, /import \{[^}]*Slider/);
  assert.match(settings, /name="soundVolume"/);
  assert.match(settings, /min=\{0\}/);
  assert.match(settings, /max=\{100\}/);
  assert.match(settings, /step=\{1\}/);
  assert.match(settings, /disabled=\{!soundEnabled\}/);
  assert.match(settings, /Form\.useWatch\('soundVolume', form\)/);
  assert.match(settings, /Number\.isFinite\(soundVolume\) \? Math\.round\(soundVolume\) : 60/);
  assert.match(settings, /\{soundVolumePercent\}%/);
  assert.match(settings, /name="petVisible"/);
  assert.match(settings, /控制右下角 CM 助手是否显示，关闭后可减少界面干扰。/);
  assert.match(settings, /qiantie:notifications-updated/);
  assert.match(layout, /qiantie:notifications-updated/);
  assert.match(layout, /petVisible \? <CmPenguinCompanion/);
});
