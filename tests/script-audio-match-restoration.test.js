import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../frontend/src/user/pages/ScriptPage.jsx', import.meta.url), 'utf8');
const generation = fs.readFileSync(new URL('../frontend/src/shared/api/generation.js', import.meta.url), 'utf8');

test('script generation exposes audio match on the fourth source tool', () => {
  assert.match(page, /aria-label="匹配音频"/);
  assert.match(page, /openAudioMatchSettings/);
  assert.match(page, /quickDirectorOptions\.matchAudio/);
  assert.match(page, /sourceAudioDurationSeconds/);
});

test('script generation sends the measured audio duration when audio matching is enabled', () => {
  assert.match(generation, /matchAudio/);
  assert.match(generation, /audioTotalSeconds/);
  assert.match(generation, /audioTotalSeconds: matchAudio === true \? audioTotalSeconds : null/);
});
