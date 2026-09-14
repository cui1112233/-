import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const generationSource = readFileSync(new URL('./generation.js', import.meta.url), 'utf8');
const scriptPageSource = readFileSync(new URL('../../user/pages/ScriptPage.jsx', import.meta.url), 'utf8');
const globalStyles = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

test('script extraction owns its error presentation instead of opening the global API dialog', () => {
  const extractionRequest = generationSource.match(
    /export function extractCharactersAndScenes[\s\S]*?return apiRequest\('\/api\/chat', \{([\s\S]*?)body: JSON\.stringify/
  );

  assert.ok(extractionRequest, 'expected to find the script extraction request');
  assert.match(extractionRequest[1], /suppressGlobalError:\s*true/);
});

test('script extraction failures use one contextual Chinese task error instead of duplicate error messages', () => {
  const extractionFlow = scriptPageSource.match(
    /async function handleExtract[\s\S]*?async function regenerateEntities/
  );

  assert.ok(extractionFlow, 'expected to find the script extraction workflow');
  assert.doesNotMatch(extractionFlow[0], /message\.error\(/);
  assert.match(extractionFlow[0], /dispatchPetState\('error', \{ title: '人物与场景提取失败'/);
});

test('dark theme error dialogs and messages use readable high contrast colors', () => {
  assert.match(globalStyles, /\[data-theme='dark'\] \.ant-modal-confirm-error \.ant-modal-content[\s\S]*?background:\s*#182235/);
  assert.match(globalStyles, /\[data-theme='dark'\] \.ant-modal-confirm-error \.ant-modal-confirm-content[\s\S]*?color:\s*#f8fbff/);
  assert.match(globalStyles, /\[data-theme='dark'\] \.ant-message-error \.ant-message-notice-content[\s\S]*?color:\s*#f8fbff/);
});

test('script page defines the video permission guard used by shot cards', () => {
  assert.match(scriptPageSource, /const \[canGenerateVideo, setCanGenerateVideo\] = useState\(false\);/);
  assert.match(scriptPageSource, /onGenerateVideo=\{canGenerateVideo \? generateVideoForShot : null\}/);
});
