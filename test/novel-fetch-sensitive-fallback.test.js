const test = require('node:test');
const assert = require('node:assert/strict');
const sensitive = require('../lib/novel-fetch-workshop/sensitive');

test('敏感词 AI 失败且未配置替换词时保留原片段，不写入合规表达', () => {
  const rules = [{ find: '男女', replace: '' }];
  const before = '明明我们就是男女朋友。';
  assert.equal(sensitive.neutralizeSensitiveSnippet(before, '男女', rules), before);
});

test('敏感词替换不会把短词映射误套到更长的普通词', () => {
  assert.equal(
    sensitive.neutralizeSensitiveSnippet('把我的玩偶拿出来。', '玩', []),
    '把我的玩偶拿出来。'
  );
});

test('敏感词 AI 失败时仍使用用户配置的替换词', () => {
  const rules = [{ find: '男女', replace: '恋人' }];
  assert.equal(
    sensitive.neutralizeSensitiveSnippet('明明我们就是男女朋友。', '男女', rules),
    '明明我们就是恋人朋友。'
  );
});

test('敏感词 AI 收到上游内容政策拒绝时保留原文且记录失败', async () => {
  const before = '她被强迫留在房间里。';
  const result = await sensitive.processSensitiveText({
    text: before,
    settings: {
      enabled: true,
      keywords: [{ find: '强迫', replace: '' }],
      retries: 0,
      aiSettings: { model: 'gemini-3' }
    },
    ai: {
      chatCompletion: async () => ({ text: "The prompt could not be submitted. The prompt contains sensitive words that violate Google's [Generative AI Prohibited Use policy]." })
    }
  });

  assert.equal(result.text, before);
  assert.equal(result.fixedCount, 0);
  assert.equal(result.fixedItems[0].status, 'failed');
  assert.match(result.fixedItems[0].error, /内容政策拒绝/);
});
