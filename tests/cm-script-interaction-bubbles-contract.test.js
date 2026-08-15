const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('script completion keeps the pet success state and CM applies only marked drafts', () => {
  const pet = read('frontend/src/shared/pet/StackyPet.jsx');
  const scriptPage = read('frontend/src/user/pages/ScriptPage.jsx');

  assert.match(scriptPage, /setGenerationStage\('complete'\);/);
  assert.match(scriptPage, /dispatchPetState\('success'\);/);
  assert.match(scriptPage, /PET_APPLY_EVENT/);
  assert.match(pet, /cmDraftToApply\(message\.content, contextRef\.current\.entities\.hasOutput\)/);
  assert.match(pet, /dispatchPetApply\(cmDraftToApply/);
  assert.match(scriptPage, /applyCmDraft\(event/);
  assert.match(scriptPage, /entities: \{[\s\S]*?hasOutput: Boolean\(output\.trim\(\)\)/);
  assert.doesNotMatch(scriptPage, /novelText: String\(novelText \|\| ''\)/);
  assert.doesNotMatch(scriptPage, /scriptOutput: output/);
  assert.match(scriptPage, /PET_SCRIPT_OUTPUT_REQUEST_EVENT/);
  assert.match(scriptPage, /event\.detail\?\.provide\(output\)/);
  assert.match(pet, /scriptOutput: requestPetScriptOutput\(\)/);
  assert.doesNotMatch(pet, /sendQuestion\(action\.prompt\)[\s\S]*?dispatchPetApply/);
});
