const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('script workbench restores and synchronously persists account-scoped drafts', () => {
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  const storage = read('frontend/src/user/pages/scriptDraftStorage.js');

  assert.match(page, /loadScriptDraft/);
  assert.match(page, /saveScriptDraft/);
  assert.match(page, /draftReadyRef/);
  assert.match(page, /const restoredDraft = loadScriptDraft/);
  assert.match(page, /const readyTimer = window\.setTimeout/);
  assert.match(page, /window\.clearTimeout\(readyTimer\)/);
  assert.match(page, /window\.addEventListener\('pagehide'/);
  assert.match(page, /onValuesChange=\{\(changed, allValues\)/);
  assert.match(page, /onChange=\{event => updateOutputDraft\(event\.target\.value\)\}/);
  assert.match(page, /persistDraft\(undefined, \{ output: nextOutput \}\)/);
  assert.match(page, /persistDraft\(\{ \.\.\.form\.getFieldsValue\(\), novelText \}\)/);
  assert.match(storage, /qiantie:script-draft:/);
  assert.match(storage, /JSON\.parse/);
  assert.match(storage, /storage\?\.setItem/);
});
