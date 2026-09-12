import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('the live /batch-factory route uses the isolated Shuihuo-based V11 design preview', () => {
  const app = fs.readFileSync(path.resolve(here, '../../App.jsx'), 'utf8');
  const preview = fs.readFileSync(path.join(here, 'Preview.jsx'), 'utf8');

  assert.match(app, /NewBatchFactoryPreviewPage = lazy\(\(\) => import\('\.\/pages\/新·批量工厂\/Preview'\)\)/);
  assert.match(app, /'\/batch-factory': NewBatchFactoryPreviewPage/);
  assert.match(app, /'\/batch-factory-preview': BatchFactoryPage/);
  assert.match(preview, /尚未连接真实数据、生成任务或上传服务/);
  assert.match(preview, /小说列表/);
  assert.match(preview, /批量操作/);
  assert.match(preview, /上传网络/);
  assert.match(preview, /role="row"/);
  assert.doesNotMatch(preview, /shared\/api\/batchFactory|batchFactoryV11/);
});
