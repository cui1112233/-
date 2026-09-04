const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('frontend/src/user/pages/ScriptPage.jsx', 'utf8');
const api = fs.readFileSync('frontend/src/shared/api/generation.js', 'utf8');

test('script page exposes the match-audio toggle and removes the old user-facing name', () => {
  assert.match(page, /aria-label="匹配音频"/);
  assert.match(page, /title="匹配音频"/);
  assert.match(page, /matchAudio: false/);
  assert.match(page, /sourceAudioDurationSeconds/);
  assert.match(page, /<Switch[\s\S]*?matchAudio/);
  assert.doesNotMatch(page, /title="快速导演分镜"/);
});

test('quick director API carries audio matching and selected constraints', () => {
  assert.match(api, /matchAudio/);
  assert.match(api, /audioTotalSeconds/);
  assert.match(api, /constraints/);
});
