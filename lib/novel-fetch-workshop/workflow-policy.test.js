const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeWorkflowPolicy,
  effectiveFetchConcurrency,
  effectiveRewriteConcurrency
} = require('./workflow-policy');
const { DEFAULT_CONFIG } = require('./mysql-store');

test('制作文件清理默认开启并保留 7 天', () => {
  assert.deepEqual(normalizeWorkflowPolicy({}).storage, {
    cleanup_enabled: true,
    retention_days: 7
  });
  assert.deepEqual(DEFAULT_CONFIG.storage, {
    cleanup_enabled: true,
    retention_days: 7
  });
});

test('制作文件保留时长只接受 7、14、30 天', () => {
  assert.equal(normalizeWorkflowPolicy({ storage: { retention_days: 14 } }).storage.retention_days, 14);
  assert.equal(normalizeWorkflowPolicy({ storage: { retention_days: 30 } }).storage.retention_days, 30);
  assert.equal(normalizeWorkflowPolicy({ storage: { retention_days: 1 } }).storage.retention_days, 7);
  assert.equal(normalizeWorkflowPolicy({ storage: { retention_days: 365 } }).storage.retention_days, 7);
  assert.equal(normalizeWorkflowPolicy({ storage: { retention_days: 'bad' } }).storage.retention_days, 7);
});

test('仍可显式关闭自动清理', () => {
  assert.equal(normalizeWorkflowPolicy({ storage: { cleanup_enabled: false } }).storage.cleanup_enabled, false);
});

test('抓取和改文并发会限制在两个活动任务内', () => {
  assert.equal(effectiveFetchConcurrency({ concurrency: 6 }), 2);
  assert.equal(effectiveRewriteConcurrency({ max_concurrency: 6 }), 2);
});

test('顺序改文始终只运行一个任务', () => {
  assert.equal(effectiveRewriteConcurrency({ max_concurrency: 6, force_serial_batch: true }), 1);
});
