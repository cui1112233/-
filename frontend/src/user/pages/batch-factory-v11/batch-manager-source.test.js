import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryV11BatchManager.jsx'), 'utf8');

test('batch manager keeps the approved intake and history entry points', () => {
  for (const label of [
    '新建批次',
    '已接收小说获取任务',
    '其他导入方式（备用）',
    '手动粘贴',
    '上传 TXT / MD',
    '历史批次'
  ]) assert.match(source, new RegExp(label));
});

test('batch manager does not call legacy Batch Factory APIs', () => {
  for (const forbidden of ['shared/api/batchFactory', '/api/batch-factory/', 'shared/api/shuihuoProduction']) {
    assert.equal(source.includes(forbidden), false, `forbidden legacy source: ${forbidden}`);
  }
});
