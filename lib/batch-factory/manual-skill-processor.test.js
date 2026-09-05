const test = require('node:test');
const assert = require('node:assert/strict');
const { createManualSkillProcessor } = require('./manual-skill-processor');

test('manual skill processor returns original content without a model when no skills are selected', async () => {
  let calls = 0;
  const processor = createManualSkillProcessor({
    skillStore: { resolveForChat: () => { throw new Error('must not resolve'); } },
    respond: async () => { calls += 1; return 'unexpected'; }
  });
  const result = await processor.preview({ username: 'alice', items: [{ title: 'A', sourceText: '正文' }], skillIds: [] });
  assert.equal(calls, 0);
  assert.equal(result.allSucceeded, true);
  assert.deepEqual(result.items[0], {
    index: 0,
    title: 'A',
    originalText: '正文',
    processedText: '正文',
    txtFileName: '',
    sourceMetadata: { originalText: '正文' },
    skillRuns: [],
    status: 'ready',
    error: ''
  });
});

test('manual skill processor resolves selected skills and returns versioned runs without skill bodies', async () => {
  const messages = [];
  const processor = createManualSkillProcessor({
    skillStore: {
      resolveForChat: (username, ids) => {
        assert.equal(username, 'alice');
        assert.deepEqual(ids, ['skill-a']);
        return [{ id: 'skill-a', name: '改写', version: 3, body: '隐藏技能正文' }];
      }
    },
    respond: async input => { messages.push(input); return '```text\n处理后正文\n```'; }
  });
  const result = await processor.preview({ username: 'alice', items: [{ title: 'A', sourceText: '原文' }], skillIds: ['skill-a'] });
  assert.equal(result.items[0].processedText, '处理后正文');
  assert.deepEqual(result.items[0].skillRuns, [{ id: 'skill-a', version: 3, status: 'succeeded' }]);
  assert.equal(JSON.stringify(result).includes('隐藏技能正文'), false);
  assert.match(messages[0].messages[0].content, /隐藏技能正文/);
  assert.match(messages[0].messages.at(-1).content, /原文/);
});

test('manual skill processor isolates item failures and keeps retryable original text', async () => {
  let count = 0;
  const processor = createManualSkillProcessor({
    skillStore: { resolveForChat: () => [{ id: 'skill-a', name: '技能', version: 1, body: '规则' }] },
    respond: async () => {
      count += 1;
      if (count === 1) throw new Error('模型暂时不可用');
      return '成功结果';
    }
  });
  const result = await processor.preview({ username: 'alice', items: [
    { title: '失败项', sourceText: '原文一' },
    { title: '成功项', sourceText: '原文二' }
  ], skillIds: ['skill-a'] });
  assert.equal(result.allSucceeded, false);
  assert.equal(result.items[0].status, 'failed');
  assert.equal(result.items[0].originalText, '原文一');
  assert.match(result.items[0].error, /模型暂时不可用/);
  assert.equal(result.items[1].status, 'ready');
  assert.equal(result.items[1].processedText, '成功结果');
});

test('manual skill processor rejects malformed skill selections before model calls', async () => {
  const processor = createManualSkillProcessor({
    skillStore: { resolveForChat: () => { const error = new Error('所选技能不可用'); error.code = 'FORBIDDEN'; throw error; } },
    respond: async () => 'never'
  });
  await assert.rejects(
    processor.preview({ username: 'alice', items: [{ title: 'A', sourceText: '正文' }], skillIds: ['missing'] }),
    error => error.code === 'FORBIDDEN'
  );
});
