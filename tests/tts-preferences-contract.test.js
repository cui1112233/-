const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('TTS preferences are account-scoped and the script page requires explicit source narration', () => {
  const configRoute = read('routes/config.js');
  const ttsPage = read('frontend/src/user/pages/TtsPage.jsx');
  const scriptPage = read('frontend/src/user/pages/ScriptPage.jsx');

  assert.match(configRoute, /tts: normalizeTtsConfig/);
  assert.match(ttsPage, /保存为默认配音/);
  assert.match(ttsPage, /getConfig/);
  assert.match(ttsPage, /saveConfig/);
  assert.match(ttsPage, /defaults\.speed/);
  assert.match(ttsPage, /defaults\.pitch/);
  assert.match(scriptPage, /accept="\.txt,text\/plain"/);
  assert.match(scriptPage, /配音原文/);
  assert.match(scriptPage, /textToSpeech/);
});
