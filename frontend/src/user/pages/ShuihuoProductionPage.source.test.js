import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(here, 'ShuihuoProductionPage.jsx');

test('shared Shuihuo library loads both commentary projects and Batch Factory batches', () => {
  const page = fs.readFileSync(pagePath, 'utf8');

  assert.match(page, /Promise\.allSettled\(\[\s*listProjects\(\{ silent: true \}\),\s*listBatches\(\)/s);
  assert.match(page, /batchFactoryProjectsFrom\(batches\)/);
  assert.match(page, /getProductionStatus\(project\.batchId/);
  assert.match(page, /getMergeStatus\(project\.batchId/);
});

test('manual batch creation in the public Shuihuo page starts detached publish-metadata classification', () => {
  const page = fs.readFileSync(pagePath, 'utf8');

  assert.match(page, /classifyFetchedBatchMetadata/);
  assert.match(page, /await classifyFetchedBatchMetadata\(batch\.id\)/);
});
