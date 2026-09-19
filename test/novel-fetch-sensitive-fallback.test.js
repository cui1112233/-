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
