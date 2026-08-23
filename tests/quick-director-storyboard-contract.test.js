const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const chat = require('../routes/chat');
const { SYSTEM_PRESETS } = require('../lib/system-preset-catalog');

test('quick director storyboard is a managed script preset with the complete video prompt contract', () => {
  const preset = SYSTEM_PRESETS.find(item => item.id === 'script-quick-director-storyboard');
  assert.ok(preset);
  assert.equal(preset.module, 'script');
  assert.equal(preset.protocolLock.slot, 'script.quick-director');
  const prompt = read('prompts/快速导演分镜.md');
  for (const required of ['{duration}', '统一风格', '统一人物', '【画面限制】', '【画质约束】', '镜头画面', '负面提示词', '10s', '15s']) {
    assert.match(prompt, new RegExp(required.replace(/[【】]/g, '\\$&')));
  }
});

test('quick director route builds a duration-resolved prompt from raw novel text', () => {
  const messages = chat._private.buildQuickDirectorMessages({ novelText: '角色在客厅发现证据。', duration: '15s' });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /15s/);
  assert.doesNotMatch(messages[0].content, /\{duration\}/);
  assert.match(messages[1].content, /角色在客厅发现证据/);
});

test('script workbench exposes quick director as the fourth source action', () => {
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  const api = read('frontend/src/shared/api/generation.js');
  assert.match(page, /aria-label="快速导演分镜"/);
  assert.match(page, /generateQuickDirectorStoryboard/);
  assert.match(api, /promptType: 'quick_director'/);
});
