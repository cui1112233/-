const test = require('node:test');
const assert = require('node:assert/strict');

const chatRouter = require('../routes/chat');
const { SYSTEM_PRESETS } = require('../lib/system-preset-catalog');

const { buildScriptMessages, buildQuickDirectorMessages } = chatRouter._private;
const scriptFormats = [
  'script-format-screenplay',
  'script-format-storyboard',
  'script-format-shortdrama',
  'script-format-shotlist',
  'script-format-q版'
];

function scriptPrompt(format, duration = '10s') {
  return buildScriptMessages({
    mode: 'continuous',
    format,
    duration,
    novelText: '林晚推开门。'
  })[0].content;
}

test('system catalog owns one editable unified script card protocol', () => {
  const preset = SYSTEM_PRESETS.find(item => item.id === 'script-card-protocol');
  assert.ok(preset);
  assert.equal(preset.name, '统一外层分镜卡片协议');
  assert.equal(preset.protocolLock.slot, 'script.card.protocol');
  assert.match(preset.body, /### 分镜一/);
  assert.match(preset.body, /只能使用统一外层标题作为卡片边界/);
});

test('all script formats receive the same system-level card protocol', () => {
  for (const presetId of scriptFormats) {
    const prompt = scriptPrompt(presetId, '15s');
    assert.match(prompt, /统一外层分镜卡片协议/);
    assert.match(prompt, /### 分镜一/);
    assert.match(prompt, /15s/);
    assert.match(prompt, /生成后.*10s 或 15s.*机械二次拆分/);
  }
});

test('quick director also receives the system-level card protocol', () => {
  const prompt = buildQuickDirectorMessages({
    novelText: '林晚推开门。',
    duration: '10s'
  })[0].content;

  assert.match(prompt, /统一外层分镜卡片协议/);
  assert.match(prompt, /### 分镜一/);
  assert.match(prompt, /生成后.*10s 或 15s.*机械二次拆分/);
});

test('editable format presets contain card-internal rules, not their own outer card heading', () => {
  for (const presetId of scriptFormats) {
    const preset = SYSTEM_PRESETS.find(item => item.id === presetId);
    assert.ok(preset);
    assert.doesNotMatch(preset.body, /^###\s+分镜[一二三四五六七八九十\d]+/m, presetId);
  }
});
