import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'giantMaterialExecutorPublic.js'), 'utf8');

test('public giant executor API keeps material id, book id, model and range in the job payload', () => {
  assert.match(source, /\/api\/shuihuo-production\/giant-material-jobs/);
  assert.match(source, /materialId/);
  assert.match(source, /platformBookId/);
  assert.match(source, /durationSeconds/);
  assert.match(source, /contentRangeLines/);
});

test('public giant executor API exposes cancel and polling helpers', () => {
  assert.match(source, /export function getGiantMaterialJob/);
  assert.match(source, /export function cancelGiantMaterialJob/);
  assert.match(source, /export async function waitForGiantMaterialJob/);
});
