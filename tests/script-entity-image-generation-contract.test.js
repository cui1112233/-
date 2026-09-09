import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helperPath = path.join(repoRoot, 'frontend', 'src', 'user', 'pages', 'scriptEntityImages.js');
const apiPath = path.join(repoRoot, 'frontend', 'src', 'shared', 'api', 'novelPanel.js');
const scriptPagePath = path.join(repoRoot, 'frontend', 'src', 'user', 'pages', 'ScriptPage.jsx');

function sourceOrEmpty(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

test('character and scene image generation has a pure payload builder', () => {
  const source = sourceOrEmpty(helperPath);
  assert.match(source, /export function buildReferenceAssetGenerationPayload/);
  assert.match(source, /asset_type/);
  assert.match(source, /generation_guidance/);
  assert.match(source, /mainImageUrl/);
});

test('script page calls the authenticated novel-panel reference image endpoint', () => {
  const apiSource = sourceOrEmpty(apiPath);
  const pageSource = sourceOrEmpty(scriptPagePath);
  assert.match(apiSource, /\/api\/novel-panel\/reference-assets\/generate/);
  assert.match(pageSource, /generateReferenceAssetImage/);
  assert.match(pageSource, /buildReferenceAssetGenerationPayload/);
  assert.match(pageSource, /setImageUrls\(current =>/);
});
