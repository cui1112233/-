import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(here, 'BatchFactoryWorkbenchPage.jsx');

test('uses only Batch Factory data and keeps novel-fetch intake handoff', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  assert.match(page, /listBatches\(\)/);
  assert.match(page, /BatchFactoryCreateModal/);
  assert.match(page, /BatchFactoryNovelList/);
  assert.match(page, /创作漫剧/);
  assert.match(page, /pendingNovelFetchIntakeId\(window\.location\.search\)/);
  assert.doesNotMatch(page, /listProjects\(/);
  assert.doesNotMatch(page, /getProductionHealth\(/);
  assert.doesNotMatch(page, /CommentaryWorkbench/);
});
