const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseUsagePayload,
  estimateTextTokens,
  estimateUsage,
  resolveUsage
} = require('../lib/team-model-runtime');
const { isBillableEntry } = require('../lib/usage-store');

test('streaming SSE usage uses the final upstream usage payload when available', () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"你好"}}]}',
    '',
    'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":30,"total_tokens":150}}',
    '',
    'data: [DONE]'
  ].join('\n');

  const parsed = parseUsagePayload(sse);
  assert.deepEqual(parsed.usage, {
    prompt_tokens: 120,
    completion_tokens: 30,
    total_tokens: 150
  });

  const resolved = resolveUsage({ messages: [] }, sse);
  assert.equal(resolved.estimated, false);
  assert.equal(resolved.usage.total_tokens, 150);
});

test('streaming SSE without upstream usage falls back to a non-zero estimate', () => {
  const payload = {
    stream: true,
    messages: [
      { role: 'system', content: '你是一个剧本助手。' },
      { role: 'user', content: '请把这一段改成短剧对白。' }
    ]
  };
  const sse = [
    'data: {"choices":[{"delta":{"content":"第一场"}}]}',
    '',
    'data: {"choices":[{"delta":{"content":"：夜，室内。"}}]}',
    '',
    'data: [DONE]'
  ].join('\n');

  const resolved = resolveUsage(payload, sse);
  assert.equal(resolved.estimated, true);
  assert.ok(resolved.usage.prompt_tokens > 0);
  assert.ok(resolved.usage.completion_tokens > 0);
  assert.equal(
    resolved.usage.total_tokens,
    resolved.usage.prompt_tokens + resolved.usage.completion_tokens
  );
});

test('token estimator handles Chinese and ASCII input deterministically', () => {
  assert.ok(estimateTextTokens('你好世界') >= 2);
  assert.ok(estimateTextTokens('hello world') >= 2);
  assert.equal(estimateTextTokens(''), 0);

  const usage = estimateUsage(
    { messages: [{ role: 'user', content: 'hello 你好' }] },
    JSON.stringify({ choices: [{ message: { content: 'world 世界' } }] })
  );
  assert.ok(usage.prompt_tokens > 0);
  assert.ok(usage.completion_tokens > 0);
});

test('failed estimated usage never consumes quota, but provider-reported billed usage can', () => {
  assert.equal(isBillableEntry({
    status: 'completed_error',
    usageKnown: true,
    metadata: { usageEstimated: true }
  }), false);
  assert.equal(isBillableEntry({
    status: 'cancelled',
    usageKnown: true,
    metadata: { usageEstimated: false }
  }), true);
  assert.equal(isBillableEntry({
    status: 'success',
    usageKnown: true,
    metadata: { usageEstimated: true }
  }), true);
});
