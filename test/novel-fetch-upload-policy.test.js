const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSavedWebSubmit } = require('../lib/novel-fetch-workshop/121-web-submit-service');

test('网站提交未设置重试次数时默认自动重试三次', () => {
  assert.equal(normalizeSavedWebSubmit({}, {}).retry_times, 3);
});

test('网站提交允许用户明确关闭自动重试', () => {
  assert.equal(normalizeSavedWebSubmit({}, { retry_times: 0 }).retry_times, 0);
});
