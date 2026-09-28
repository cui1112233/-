import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, 'GiantMaterialTestPage.jsx'), 'utf8');
const app = fs.readFileSync(path.join(here, '..', 'App.jsx'), 'utf8');

test('test page exposes the four read stages and does not register a batch', () => {
  for (const label of ['素材解析', '视频读取', '滚屏 OCR', '小说正文']) assert.match(page, new RegExp(label));
  assert.match(page, /giantMaterialId/);
  assert.doesNotMatch(page, /createManualIntake|createBatchFromIntake|appendNovelFetchIntake/);
});

test('test route is rendered before the authenticated application shell', () => {
  assert.match(app, /GiantMaterialTestPage/);
  assert.match(app, /pathname === '\/giant-material-test'/);
});

test('uses the shared status card and exposes Qingyu auth states', () => {
  assert.match(page, /GiantMaterialStatusCard/);
  assert.match(page, /正在请求青语素材接口/);
  assert.match(page, /QINGYU_AUTH_NOT_CONFIGURED/);
  assert.match(page, /QINGYU_AUTH_FAILED/);
  assert.match(page, /正在整理正文/);
});
