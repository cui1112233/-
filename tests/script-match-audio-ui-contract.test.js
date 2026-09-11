const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('frontend/src/user/pages/ScriptPage.jsx', 'utf8');
const api = fs.readFileSync('frontend/src/shared/api/generation.js', 'utf8');

test('script page exposes match audio as a normal generation setting', () => {
  assert.match(page, /aria-label="匹配音频"/);
  assert.match(page, /title="匹配音频设置"/);
  assert.match(page, /matchAudio: false/);
  assert.match(page, /sourceAudioDurationSeconds/);
  assert.doesNotMatch(page, /画面描述模式/);
  assert.doesNotMatch(page, /分析并生成/);
  assert.doesNotMatch(page, /generateQuickDirectorStoryboard/);
});

test('normal generateScript API carries audio matching in the same script request', () => {
  assert.match(api, /export async function generateScript\(\{[\s\S]*?matchAudio[\s\S]*?audioTotalSeconds/);
  assert.match(api, /promptType: 'script'/);
  assert.match(api, /matchAudio: resolved\.matchAudio === true/);
  assert.match(api, /audioTotalSeconds:/);
});
