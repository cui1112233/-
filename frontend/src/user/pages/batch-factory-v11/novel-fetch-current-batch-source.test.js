import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, '../../../..');
const repoDir = path.resolve(frontendDir, '..');

test('process results identify the submitted batch without replacing persisted history', () => {
  const source = fs.readFileSync(path.join(repoDir, 'routes/batch-rewrite.js'), 'utf8');
  assert.match(source, /current_batch_ids/);
  assert.match(source, /prepared\.map\(item => String\(item\.bookId/);
  assert.match(source, /tasks: await listTasks\(req\)/);
});

test('novel fetch defaults to the latest submitted batch and keeps date history available', () => {
  const source = fs.readFileSync(path.join(frontendDir, 'public/batch-rewrite/app.js'), 'utf8');
  assert.match(source, /currentBatchIds/);
  assert.match(source, /currentBatchDate/);
  assert.match(source, /viewMode/);
  assert.match(source, /current_batch_ids/);
  assert.match(source, /taskDateFilter/);
  assert.match(source, /历史任务可切换日期查看/);
});

test('legacy visibility hotfix does not replace an intentional current-batch view with older dates', () => {
  const source = fs.readFileSync(path.join(frontendDir, 'public/batch-rewrite/task-visibility-hotfix.js'), 'utf8');
  assert.match(source, /currentBatchIds/);
  assert.match(source, /viewMode/);
  assert.match(source, /当前批次/);
});
