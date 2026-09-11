const test = require('node:test');
const assert = require('node:assert/strict');
const { snakeTask } = require('../routes/batch-rewrite');

test('snakeTask preserves snake_case task metadata from workshop storage', () => {
  const task = snakeTask({
    book_id: '7674515088685943832',
    book_name: '测试书名',
    platform_id: '2',
    platform_name: '番茄付费',
    style: '现代甜文',
    gender: '女频',
    classify_status: 'failed',
    classifier_model: 'classifier-model',
    original_status: 'done',
    original_chars: 1234,
    original_raw_chars: 1400,
    ai_status: 'skipped',
    ai_count: 1,
    sensitive_hit_count: 2,
    site_submit_status: 'not_submitted',
    created_at: '2026-09-06T21:54:43+08:00',
  });

  assert.equal(task.id, '7674515088685943832');
  assert.equal(task.book_id, '7674515088685943832');
  assert.equal(task.book_name, '测试书名');
  assert.equal(task.platform_id, '2');
  assert.equal(task.platform_name, '番茄付费');
  assert.equal(task.style, '现代甜文');
  assert.equal(task.gender, '女频');
  assert.equal(task.classify_status, 'failed');
  assert.equal(task.classifier_model, 'classifier-model');
  assert.equal(task.original_status, 'done');
  assert.equal(task.original_chars, 1234);
  assert.equal(task.original_raw_chars, 1400);
  assert.equal(task.ai_status, 'skipped');
  assert.equal(task.sensitive_hit_count, 2);
  assert.equal(task.site_submit_status, 'not_submitted');
});
