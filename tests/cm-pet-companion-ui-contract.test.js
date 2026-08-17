const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('CM integrates proactive companion speech without interrupting chat or tasks', () => {
  const pet = read('frontend/src/shared/pet/StackyPet.jsx');
  assert.match(pet, /getCompanionCandidate/);
  assert.match(pet, /COMPANION_SPEECH_PRIORITY/);
  assert.match(pet, /document\.visibilityState === 'visible'/);
  assert.match(pet, /!chatOpen && !asking && !dragRef\.current/);
  assert.match(pet, /window\.setTimeout\(/);
  assert.match(pet, /window\.clearTimeout\(/);
  assert.match(pet, /priority >= current\.priority/);
  assert.match(pet, /getClickSpeech/);
  assert.match(pet, /if \(draggedRef\.current\)/);
  assert.match(pet, /reply \|\| petSpeech\(state\)/);
});
