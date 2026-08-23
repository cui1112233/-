const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('script workbench restores and synchronously persists tab-isolated drafts', () => {
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  const storage = read('frontend/src/user/pages/scriptDraftStorage.js');

  assert.match(page, /getScriptDraftTabId/);
  assert.match(page, /draftTabIdRef/);
  assert.match(page, /getScriptDraftTabId\(window\.sessionStorage\)/);
  assert.match(page, /loadScriptDraft\(window\.localStorage, draftUsernameRef\.current, draftTabIdRef\.current\)/);
  assert.match(page, /saveScriptDraft\(window\.localStorage, draftUsernameRef\.current, draftTabIdRef\.current,/);
  assert.match(page, /draftReadyRef/);
  assert.match(page, /const restoredDraft = loadScriptDraft/);
  assert.match(page, /const readyTimer = window\.setTimeout/);
  assert.match(page, /window\.clearTimeout\(readyTimer\)/);
  assert.match(page, /window\.addEventListener\('pagehide'/);
  assert.match(page, /onValuesChange=\{\(changed, allValues\)/);
  assert.match(page, /onChange=\{event => updateOutputDraft\(event\.target\.value\)\}/);
  assert.match(page, /persistDraft\(undefined, \{ output: nextOutput \}\)/);
  assert.match(page, /shotVideoTasks/);
  assert.match(page, /restoredDraft\.shotVideoTasks/);
  assert.match(page, /updateOutputDraft\(nextOutput\);/);
  assert.doesNotMatch(page, /function openRevisionPreview[\s\S]*?updateOutputDraft\(candidateOutput\)/);
  assert.match(page, /revisionPreview\.currentOutput !== output/);
  assert.match(page, /setPreviousOutput\(output\);[\s\S]*?updateOutputDraft\(nextOutput\);/);
  assert.match(page, /updateOutputDraft\(previousOutput\);[\s\S]*?setPreviousOutput\(''\);/);
  assert.match(page, /persistDraft\(\{ \.\.\.form\.getFieldsValue\(\), novelText \}\)/);
  assert.match(storage, /qiantie:script-draft:/);
  assert.match(storage, /JSON\.parse/);
  assert.match(storage, /storage\?\.setItem/);

  const historyCall = page.match(/await saveHistory\(\{([\s\S]*?)\}\);/);
  assert.ok(historyCall);
  const historyKeys = [...historyCall[1].matchAll(/^\s*(\w+):/gm)].map(match => match[1]);
  assert.deepEqual(historyKeys, ['id', 'mode', 'format', 'formatName', 'duration', 'output']);
  assert.equal(historyKeys.includes('tabId'), false);
  assert.equal(historyKeys.includes('draftTabId'), false);
});
