import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = relative => fs.readFileSync(path.join(here, relative), 'utf8');

test('Novel Fetch outer page accepts only the same-origin V11 intake redirect message', () => {
  const source = read('NovelFetchPage.jsx');
  assert.match(source, /addEventListener\(['"]message['"]/);
  assert.match(source, /qiantie:batch-factory-intake/);
  assert.match(source, /event\.origin\s*!==\s*window\.location\.origin/);
  assert.match(source, /redirectTo/);
  assert.match(source, /\/batch-factory/);
});

test('real V11 empty state sends the user to Novel Fetch instead of a demo page', () => {
  const source = read('batch-factory-v11/BatchFactoryV11UiPage.jsx');
  assert.match(source, /去小说获取并导入/);
  assert.match(source, /\/novel-fetch/);
  assert.doesNotMatch(source, /BatchFactoryPreviewPage|示例批次/);
});
