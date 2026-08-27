import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('frontend/src/user/pages/BatchFactoryPreviewPage.jsx', 'utf8');
const css = fs.readFileSync('frontend/src/user/pages/batch-factory-preview.css', 'utf8');

test('V6 status center and current filter are separate sibling regions', () => {
  assert.match(page, /bf-preview-status-center/);
  assert.match(page, /bf-preview-current-filter/);
  assert.match(page, /bf-preview-status-center[\s\S]*bf-preview-current-filter/);
});

test('V6 production settings exposes mode and prompt preset selectors', () => {
  assert.match(page, /生产方式/);
  assert.match(page, /剧本提示词/);
  assert.match(page, /人物场景提示词/);
  assert.match(page, /高级生成设置/);
  assert.match(page, /exactDuration/);
});

test('V6 full batch progress exposes per-book task details', () => {
  assert.match(page, /全批次进度明细/);
  assert.match(page, /project\?\.tasks/);
  assert.match(page, /重试任务/);
  assert.match(page, /取消任务/);
});

test('V6 responsive layout keeps status center height bounded', () => {
  assert.match(css, /bf-preview-status-center[\s\S]*max-height/);
  assert.match(css, /bf-preview-current-filter[\s\S]*overflow/);
});
