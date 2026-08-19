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
  assert.match(pet, /function handleVisibilityChange\(\) \{\s+if \(document\.visibilityState !== 'visible'\) \{\s+getCompanionCandidate\(\{[\s\S]*?visible: false,[\s\S]*?\}\);\s+clearCompanionSpeech\(\);\s+\} else scheduleCompanionSpeech\(\);\s+\}/);
  assert.match(pet, /priority >= current\.priority/);
  assert.match(pet, /if \(companionActive && !chatOpen\)/);
  assert.match(pet, /const text = getClickSpeech\(/);
  assert.match(pet, /if \(draggedRef\.current\)/);
  assert.match(pet, /reply \|\| petSpeech\(state\)/);
});

test('settings exposes a local CM proactive speech switch', () => {
  const settings = read('frontend/src/user/pages/SettingsPage.jsx');
  const pet = read('frontend/src/shared/pet/StackyPet.jsx');
  assert.match(settings, /宠物主动说话/);
  assert.match(settings, /Switch/);
  assert.match(settings, /getCurrentUsername/);
  assert.match(settings, /readCompanionSpeechState/);
  assert.match(settings, /writeCompanionSpeechState/);
  assert.match(settings, /PET_COMPANION_SETTINGS_EVENT/);
  assert.match(settings, /nextIdleAt: 0/);
  assert.match(settings, /new CustomEvent\(PET_COMPANION_SETTINGS_EVENT, \{ detail: \{ active: checked, username \} \}\)/);
  assert.doesNotMatch(settings, /active: values\.active/);
  assert.match(pet, /PET_COMPANION_SETTINGS_EVENT/);
  assert.match(pet, /window\.addEventListener\(PET_COMPANION_SETTINGS_EVENT, handleCompanionSettings\)/);
  assert.match(pet, /setCompanionActive\(active\);[\s\S]*?if \(!active\) clearCompanionSpeech\(\);/);
});
