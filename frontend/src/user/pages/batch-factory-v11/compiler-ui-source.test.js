import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workbench = fs.readFileSync(new URL('./BatchFactoryV11Workbench.jsx', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('./BatchFactoryV11UiPage.jsx', import.meta.url), 'utf8');
const drawer = fs.readFileSync(new URL('./FinalPromptPreviewDrawer.jsx', import.meta.url), 'utf8');

test('compiler preview is capability gated and calls the live V11 runtime', () => {
  assert.match(workbench, /compiler\.preview/);
  assert.match(workbench, /onPreviewFinalPrompt/);
  assert.match(page, /runtime\.previewFinalPrompt/);
});

test('final prompt drawer is read-only and exposes identity and setting sources', () => {
  assert.match(drawer, /只读预览/);
  assert.match(drawer, /directorRevisionId/);
  assert.match(drawer, /snapshotHash/);
  assert.match(drawer, /sourceByField/);
  assert.doesNotMatch(drawer, /提交生产|onSubmit/);
});
