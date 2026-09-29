import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryGiantMaterialExecutorStatus.jsx'), 'utf8');

test('status bar exposes install, model download, OCR, complete and failure states', () => {
  for (const text of ['执行器未安装或未启动', '正在下载 OCR 模型', '正在 OCR', '已完成', '失败原因']) assert.match(source, new RegExp(text));
});

test('status bar polls loopback health and never hides an offline executor', () => {
  assert.match(source, /127\.0\.0\.1:17861/);
  assert.match(source, /setInterval|setTimeout/);
  assert.match(source, /modelReady/);
});
