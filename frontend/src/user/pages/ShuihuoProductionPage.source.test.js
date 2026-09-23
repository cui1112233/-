import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, 'ShuihuoProductionPage.jsx'), 'utf8');

test('keeps Batch Factory works visible when the legacy Shuihuo project endpoint is unavailable', () => {
  assert.match(page, /Promise\.allSettled\(\s*\[\s*listProjects\(\{ silent: true \}\),\s*listBatches\(\)\s*\]\)/);
  assert.match(page, /const batchProjects = batchFactoryProjectsFrom\(batches\);/);
});

test('does not restart H3 asset extraction merely to decorate the project library', () => {
  assert.doesNotMatch(page, /listBookAssets\(project\.batchId, firstBook\.id/);
  assert.doesNotMatch(page, /listBookAssetImages\(project\.batchId, firstBook\.id/);
});

test('does not show a legacy Shuihuo health failure inside the Batch Factory workbench', () => {
  assert.match(page, /listProjects\(\{ silent: true \}\)/);
  assert.match(page, /getProductionHealth\(\{ silent: true \}\)/);
  assert.match(page, /view === 'studio' && healthError/);
});
