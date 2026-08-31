const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeWorkflowPolicy,
  shortOriginalDecision,
  shouldReclassifyStyle,
  effectiveRewriteConcurrency,
  splitSubmitBatches
} = require('../lib/novel-fetch-workshop/workflow-policy');

test('advanced workflow policy preserves explicit false and clamps numeric values', () => {
  const policy = normalizeWorkflowPolicy({
    fetch: { min_original_chars: -9, skip_short_original: false },
    workflow: { auto_sync_site_styles: false, auto_reclassify_invalid_style: true },
    storage: { cleanup_enabled: false, retention_days: 99999 },
    web_submit: { batch_size: 0, flush_seconds: 9999 },
    ai: { force_serial_batch: false },
    sensitive_ai: { enabled: true, mode: 'ai_group' }
  });
  assert.equal(policy.fetch.min_original_chars, 0);
  assert.equal(policy.fetch.skip_short_original, false);
  assert.equal(policy.workflow.auto_sync_site_styles, false);
  assert.equal(policy.workflow.auto_reclassify_invalid_style, true);
  assert.equal(policy.storage.cleanup_enabled, false);
  assert.equal(policy.storage.retention_days, 3650);
  assert.equal(policy.web_submit.batch_size, 1);
  assert.equal(policy.web_submit.flush_seconds, 300);
  assert.equal(policy.ai.force_serial_batch, false);
  assert.equal(policy.sensitive_ai.mode, 'ai_group');
});

test('missing sensitive mode preserves old V78 semantics', () => {
  assert.equal(normalizeWorkflowPolicy({ sensitive_ai: { enabled: true } }).sensitive_ai.mode, 'ai_each');
  assert.equal(normalizeWorkflowPolicy({ sensitive_ai: { enabled: false } }).sensitive_ai.mode, 'replace');
});

test('short-original policy only skips when explicitly enabled and below threshold', () => {
  assert.deepEqual(shortOriginalDecision('12345', { min_original_chars: 10, skip_short_original: true }), { chars: 5, skipped: true });
  assert.deepEqual(shortOriginalDecision('12345', { min_original_chars: 10, skip_short_original: false }), { chars: 5, skipped: false });
});

test('invalid style is reclassified only when server catalog rejects it and policy is enabled', () => {
  assert.equal(shouldReclassifyStyle('复仇', ['复仇', '甜宠'], true), false);
  assert.equal(shouldReclassifyStyle('不存在', ['复仇', '甜宠'], true), true);
  assert.equal(shouldReclassifyStyle('不存在', ['复仇', '甜宠'], false), false);
});

test('force serial overrides configured rewrite concurrency', () => {
  assert.equal(effectiveRewriteConcurrency({ max_concurrency: 8, force_serial_batch: true }), 1);
  assert.equal(effectiveRewriteConcurrency({ max_concurrency: 8, force_serial_batch: false }), 8);
});

test('automatic submission is split into bounded batches', () => {
  assert.deepEqual(splitSubmitBatches(['1','2','3','4','5'], 2), [['1','2'],['3','4'],['5']]);
});
