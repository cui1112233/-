const test = require('node:test');
const assert = require('node:assert/strict');

const { retryPlanForTask } = require('../routes/batch-rewrite');

test('已有原文但 AI 失败时，旧版重试计划不再重新抓取原文', () => {
  assert.deepEqual(retryPlanForTask({
    originalStatus: 'done',
    aiStatus: 'failed',
    aiError: '模型返回错误'
  }), {
    stage: 'rewrite',
    fetchOriginal: false,
    applyOriginalRules: false,
    generateAi: true
  });
});

test('原文抓取失败时才允许旧版重试重新抓取原文', () => {
  assert.deepEqual(retryPlanForTask({
    originalStatus: 'failed',
    originalErrorCode: 'UPSTREAM_TIMEOUT'
  }), {
    stage: 'original',
    fetchOriginal: true,
    applyOriginalRules: true,
    generateAi: true
  });
});

test('没有失败阶段的任务不会被旧版重试再次处理', () => {
  assert.deepEqual(retryPlanForTask({ originalStatus: 'done', aiStatus: 'done' }), {
    stage: null,
    fetchOriginal: false,
    applyOriginalRules: false,
    generateAi: false
  });
});
