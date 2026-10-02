import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(here, 'ShuihuoProductionPage.jsx');

test('shared Shuihuo library loads batch summaries instead of every full original and storyboard', () => {
  const page = fs.readFileSync(pagePath, 'utf8');

  assert.match(page, /Promise\.allSettled\(\[\s*listProjects\(\{ silent: true \}\),\s*listBatchSummaries\(\)/s);
  assert.match(page, /batchFactoryProjectsFrom\(batches\)/);
  assert.match(page, /getProductionStatus\(project\.batchId/);
  assert.match(page, /getMergeStatus\(project\.batchId/);
});

test('shared project library renders before bounded cover hydration finishes', () => {
  const page = fs.readFileSync(pagePath, 'utf8');

  assert.match(page, /setProjects\(baseProjects\);\s*setLoading\(false\);\s*void coverHydrationSchedulerRef\.current\(\(\) => enrichBatchProjectCovers/s);
  assert.doesNotMatch(page, /await Promise\.all\(batchProjects\.map/);
  assert.match(page, /concurrency:\s*2/);
  assert.match(page, /if \(!mountedRef\.current \|\| requestId !== refreshRequestRef\.current\) return;\s*setProjects\(baseProjects\)/s);
  assert.match(page, /if \(!metadata\.hadRequestFailure \|\| coveredProject\.coverMedia\)/);
  assert.match(page, /if \(requestId === refreshRequestRef\.current\) \{\s*console\.error\('\[共享作品库\] 批量工厂读取失败'/s);
});

test('manual batch creation in the public Shuihuo page starts detached publish-metadata classification', () => {
  const page = fs.readFileSync(pagePath, 'utf8');

  assert.match(page, /classifyFetchedBatchMetadata/);
  assert.match(page, /await classifyFetchedBatchMetadata\(batch\.id\)/);
});
