import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(here, name), 'utf8');

test('giant jobs bind against the latest persisted book revision', () => {
  const source = read('BatchFactoryCreateModal.jsx');
  assert.match(source, /getBatch\(batchId\)/);
  assert.match(source, /findRegisteredGiantMaterialBook\(latestBatch\?\.books/);
  assert.match(source, /executorJobId: createdJob\.id/);
  assert.match(source, /giantAutomationPlan/);
});

test('giant OCR progress is displayed in the production-content editor', () => {
  const source = read('BatchFactoryNovelList.jsx');
  const editor = source.slice(source.indexOf('编辑生产内容'));
  assert.match(editor, /BatchFactoryGiantMaterialPendingProgress/);
  assert.match(editor, /onContentReady=\{refreshBatch\}/);
  assert.match(read('BatchFactoryGiantMaterialPendingProgress.jsx'), /startBatchAutomation/);
});
