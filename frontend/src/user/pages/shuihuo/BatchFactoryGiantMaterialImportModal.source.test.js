import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryGiantMaterialImportModal.jsx'), 'utf8');

test('giant material import delegates OCR to the resident executor', () => {
  assert.match(source, /resolveGiantMaterial/);
  assert.match(source, /createGiantMaterialJob/);
  assert.match(source, /waitForGiantMaterialJob/);
  assert.match(source, /BatchFactoryGiantMaterialExecutorStatus/);
  assert.match(source, /GIANT_EXECUTOR_OFFLINE/);
  assert.doesNotMatch(source, /readGiantMaterialContent/);
});

test('giant material import preserves the selected content range in the executor payload', () => {
  assert.match(source, /contentRangeLines/);
  assert.match(source, /durationSeconds/);
  assert.match(source, /modelVersion/);
});

test('giant import claims a resolved book before it dispatches OCR', () => {
  assert.match(source, /createGiantMaterialPlatformBookClaims/);
  assert.match(source, /duplicateReason:\s*'same_submission_platform_book'/);
  assert.match(source, /claims\.claim\(/);
});
