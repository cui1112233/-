import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, 'ShuihuoProductionPage.jsx'), 'utf8');

test('keeps Batch Factory works visible when the legacy Shuihuo project endpoint is unavailable', () => {
  assert.match(page, /Promise\.allSettled\(\[listProjects\(\{ silent: true \}\), listBatches\(\)\]\)/);
  assert.match(page, /const waterProjects = water\.status === 'fulfilled' \? water\.value\.projects \|\| \[\] : \[\]/);
  assert.match(page, /const batchProjects = batch\.status === 'fulfilled' \? batchFactoryProjectsFrom\(batch\.value\.batches\) : \[\]/);
});


test('does not show a legacy Shuihuo health failure inside the Batch Factory workbench', () => {
  assert.match(page, /listProjects\(\{ silent: true \}\)/);
  assert.match(page, /getProductionHealth\(\{ silent: true \}\)/);
  assert.match(page, /view === 'studio' && healthError/);
});
