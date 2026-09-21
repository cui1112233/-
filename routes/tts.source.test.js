const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'tts.js'), 'utf8');

test('routes speech synthesis through the current 121 TTS host', () => {
  assert.match(source, /tts3\.121w\.com/);
  assert.doesNotMatch(source, /tts2\.121w\.com/);
});
