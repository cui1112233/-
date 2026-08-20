// 改文工作台：敏感词处理测试
// 覆盖：普通模式 find→replace 全局替换与命中计数、groups 词表归一与 scope 过滤、
// AI 模式 snippet 断句切分 + 回拼、AI 失败回落中性替换词。
const { test } = require('node:test');
const assert = require('node:assert');
const {
  processSensitiveText,
  normalizeSensitiveRules,
  findSensitiveHits,
  applySensitiveReplace
} = require('../lib/novel-fetch-workshop/sensitive');

test('普通模式：find→replace 全局替换并统计命中', async () => {
  const settings = {
    enabled: false,
    keywords: [
      { find: '艹', replace: '草' },
      { find: '卧槽', replace: '天哪' }
    ]
  };
  const result = await processSensitiveText({ text: '艹，真是艹蛋。卧槽！', settings });
  assert.equal(result.text, '草，真是草蛋。天哪！');
  // 两次「艹」同一断句片段合并为一次命中，加「卧槽」共 2 个命中片段（「，」非断句符）
  assert.equal(result.hits.length, 2);
  assert.equal(result.fixedCount, 2);
  assert.equal(result.hits[0].snippet, '艹，真是艹蛋。');
  assert.equal(result.hits[1].snippet, '卧槽！');
});

test('普通模式：配置了替换词时命中片段含上下文', async () => {
  const settings = {
    enabled: false,
    keywords: [{ find: '小三', replace: '第三者' }]
  };
  const result = await processSensitiveText({ text: '她竟是小三，真想不到。', settings });
  assert.equal(result.text, '她竟是第三者，真想不到。');
  assert.equal(result.hits.length, 1);
  assert.ok(result.hits[0].snippet.includes('小三'));
  assert.ok(result.hits[0].keyword.includes('小三'));
});

test('normalizeSensitiveRules：groups 结构展开、组级 scope 继承、禁用组跳过', () => {
  const rules = normalizeSensitiveRules({
    groups: [
      {
        name: 'g1',
        enabled: true,
        apply_to_original: true,
        apply_to_ai: false,
        rules: [
          { find: '甲', replace: '乙', enabled: true },
          { find: '丙', replace: '', enabled: false }
        ]
      },
      { name: 'g2', enabled: false, rules: [{ find: '丁', replace: '', enabled: true }] }
    ]
  });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].find, '甲');
  assert.equal(rules[0].apply_to_original, true);
  assert.equal(rules[0].apply_to_ai, false);
});

test('findSensitiveHits：同一片段内多个关键词合并为一次命中', () => {
  const rules = [
    { find: '小三', replace: '第三者', enabled: true },
    { find: '出轨', replace: '', enabled: true }
  ];
  const hits = findSensitiveHits('她出轨又当小三，真是离谱。', rules, { contextChars: 12 });
  assert.ok(hits.length >= 1);
  // 同一断句片段内的关键词合并在一个 hit.keywords 中
  assert.ok(hits.some(hit => hit.keywords.includes('小三') && hit.keywords.includes('出轨')));
});

test('AI 模式：按断句切 snippet 调 AI 并回拼原文', async () => {
  const ai = {
    chatCompletion: async () => ({ text: '她轻声说：冷静点', raw: {} })
  };
  const settings = {
    enabled: true,
    keywords: [{ find: '艹', replace: '草' }],
    context_chars: 12
  };
  const result = await processSensitiveText({ text: '她说：艹，真烦。他回答。', settings, ai });
  // snippet 按断句符「。」切为「她说：艹，真烦。」，AI 改写后按 span 拼回
  assert.ok(result.text.startsWith('她轻声说：冷静点'));
  assert.ok(result.text.endsWith('他回答。'));
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].snippet, '她说：艹，真烦。');
  assert.equal(result.fixedCount, 1);
});

test('AI 模式：多个命中并发修复并整体回拼', async () => {
  let calls = 0;
  const ai = {
    chatCompletion: async () => {
      calls += 1;
      return { text: `改写片段${calls}`, raw: {} };
    }
  };
  const settings = {
    enabled: true,
    keywords: [{ find: '艹', replace: '草' }],
    context_chars: 12
  };
  const result = await processSensitiveText({ text: '艹，第一处。艹，第二处。', settings, ai });
  assert.equal(calls, 2);
  assert.equal(result.fixedCount, 2);
  assert.ok(result.text.includes('改写片段1'));
  assert.ok(result.text.includes('改写片段2'));
});

test('AI 模式：失败回落中性替换词（配置的替换词优先）', async () => {
  const ai = {
    chatCompletion: async () => { throw new Error('上游失败'); }
  };
  const settings = {
    enabled: true,
    keywords: [{ find: '艹', replace: '草' }]
  };
  const result = await processSensitiveText({ text: '她骂了句艹。', settings, ai });
  // 回落使用配置的替换词「草」
  assert.equal(result.text, '她骂了句草。');
  assert.equal(result.fixedCount, 1);
  assert.equal(result.hits.length, 1);
});

test('AI 模式：无配置替换词回落内置中性词', async () => {
  const ai = {
    chatCompletion: async () => { throw new Error('上游失败'); }
  };
  const settings = {
    enabled: true,
    keywords: [{ find: '小三', replace: '' }]
  };
  const result = await processSensitiveText({ text: '她竟是小三，真想不到。', settings, ai });
  assert.ok(result.text.includes('第三者'));
  assert.equal(result.fixedCount, 1);
});

test('AI 模式：无命中时原样返回', async () => {
  const ai = {
    chatCompletion: async () => ({ text: '不应被调用', raw: {} })
  };
  const settings = {
    enabled: true,
    keywords: [{ find: '艹', replace: '草' }]
  };
  const result = await processSensitiveText({ text: '这是一段干净的文字。', settings, ai });
  assert.equal(result.text, '这是一段干净的文字。');
  assert.equal(result.hits.length, 0);
  assert.equal(result.fixedCount, 0);
});

test('applySensitiveReplace：字面量全局替换（不解释正则）', () => {
  const rules = normalizeSensitiveRules([{ find: 'a.b', replace: 'X', enabled: true }]);
  assert.equal(applySensitiveReplace('a.b 与 aXb', rules), 'X 与 aXb');
});
