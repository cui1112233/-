import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryGiantMaterialPendingProgress.jsx'), 'utf8');

test('explains that a missing executor job was never dispatched and offers direct original retrieval', () => {
  assert.match(source, /OCR 任务未派发/);
  assert.match(source, /原文获取/);
});
