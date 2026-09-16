import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./ScriptPage.jsx', import.meta.url), 'utf8');

test('script page places the source audio player below the extraction instruction', () => {
  const instructionIndex = source.indexOf('script-instruction-status');
  const audioIndex = source.indexOf('script-source-audio-card');
  assert.ok(instructionIndex >= 0, 'extraction instruction status should remain visible');
  assert.ok(audioIndex > instructionIndex, 'source audio card should follow the extraction instruction');
  assert.match(source, /当前配音/);
  assert.match(source, /正在生成原文配音/);
  assert.match(source, /sourceAudioError/);
});
