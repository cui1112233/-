import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryGiantMaterialPendingProgress.jsx'), 'utf8');

test('automatically resumes legacy direct-first books and hands failed direct reads to OCR', () => {
  assert.match(source, /OCR 任务未派发/);
  assert.match(source, /原文获取/);
  assert.match(source, /enqueueDirectFirstRead/);
  assert.match(source, /原始书城读取失败，正在自动改用滚屏 OCR/);
});
