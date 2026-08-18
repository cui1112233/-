// 改文工作台：男女频/风格 AI 分类测试
const { test } = require('node:test');
const assert = require('node:assert');
const { buildClassifyMessages, parseClassifyResult, classifyMissingRows } = require('../lib/novel-fetch-workshop/classifier');

const STYLES = ['古风虐文','现代虐文','现代女主','男频都市'];

test('buildClassifyMessages 指示固定风格与男女频', () => {
  const [system, user] = buildClassifyMessages({
    fixedStyles: STYLES,
    items: [{ row_number: 1, book_id: '123', book_name: 'x', existing_gender: '', existing_style: '', tags: 'a', reason: 'r', rating: 'S' }]
  });
  assert.match(system.content, /男频或女频/);
  assert.match(system.content, /固定风格类型/);
  const parsed = JSON.parse(user.content);
  assert.deepEqual(parsed.fixed_styles, STYLES);
  assert.equal(parsed.items[0].row_number, 1);
});

test('parseClassifyResult 按 row_number 回填', () => {
  const tasks = [{ bookId: '123', gender: '', style: '' }];
  const text = JSON.stringify({ results: [{ row_number: 1, book_id: '123', style: '现代虐文', gender: '女频', confidence: '0.9', reason: '题材匹配' }] });
  parseClassifyResult(text, tasks, STYLES);
  assert.equal(tasks[0].style, '现代虐文');
  assert.equal(tasks[0].gender, '女频');
  assert.equal(tasks[0].styleSource, 'ai');
  assert.equal(tasks[0].classifyStatus, 'classified');
  assert.equal(tasks[0].classifyConfidence, 0.9);
});

test('parseClassifyResult 非法风格置 failed', () => {
  const tasks = [{ bookId: '123', gender: '', style: '' }];
  const text = JSON.stringify({ results: [{ row_number: 1, style: '不存在的风格', gender: '女频' }] });
  parseClassifyResult(text, tasks, STYLES);
  assert.equal(tasks[0].classifyStatus, 'failed');
  assert.match(tasks[0].classifyError, /不在固定列表/);
});

test('classifyMissingRows 未配置 AI 置 waiting_ai_config', async () => {
  const configStore = { getConfig: () => ({ ai_assignments: { classifier: '__current__' } }), getStyles: () => STYLES };
  const ai = { resolveAiSettings: () => ({ baseUrl: '', apiKey: '', model: '' }) };
  const tasks = [{ bookId: '1', style: '' }];
  const res = await classifyMissingRows({ configStore, ai, tasks });
  assert.equal(res.tasks[0].classifyStatus, 'waiting_ai_config');
});

test('classifyMissingRows 调用 ai 并回填', async () => {
  const configStore = { getConfig: () => ({ ai_assignments: { classifier: '__current__' } }), getStyles: () => STYLES };
  const ai = {
    resolveAiSettings: () => ({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' }),
    chatCompletion: async () => ({ text: JSON.stringify({ results: [{ row_number: 1, style: '现代女主', gender: '女频', confidence: '0.85', reason: 'x' }] }), raw: {} })
  };
  const tasks = [{ bookId: '1', style: '' }];
  const res = await classifyMissingRows({ configStore, ai, tasks });
  assert.equal(res.tasks[0].style, '现代女主');
  assert.equal(res.tasks[0].gender, '女频');
  assert.equal(res.tasks[0].classifierModel, 'm');
});

// 追加：防御上游 error 键（Task 3 minor #2）
test('parseClassifyResult 防御上游 error 键置 failed', () => {
  const tasks = [{ bookId: '1', style: '', gender: '' }];
  const text = JSON.stringify({ error: { message: '上游错误' } });
  parseClassifyResult(text, tasks, STYLES);
  assert.equal(tasks[0].classifyStatus, 'failed');
  assert.match(tasks[0].classifyError, /AI分类失败/);
});

// 追加：style 与 gender 齐全的任务置 input_ready，不调用 AI
test('classifyMissingRows 齐全任务置 input_ready', async () => {
  const configStore = { getConfig: () => ({ ai_assignments: { classifier: '__current__' } }), getStyles: () => STYLES };
  const ai = { resolveAiSettings: () => ({ baseUrl: '', model: '' }) };
  const tasks = [{ bookId: '1', style: '现代虐文', gender: '女频' }];
  const res = await classifyMissingRows({ configStore, ai, tasks });
  assert.equal(res.tasks[0].classifyStatus, 'input_ready');
});

// 追加：调用失败置 failed 并汇总错误
test('classifyMissingRows 调用失败置 failed', async () => {
  const configStore = { getConfig: () => ({ ai_assignments: { classifier: '__current__' } }), getStyles: () => STYLES };
  const ai = {
    resolveAiSettings: () => ({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', retry_times: 0 }),
    chatCompletion: async () => { throw new Error('请求失败'); }
  };
  const tasks = [{ bookId: '1', style: '' }];
  const res = await classifyMissingRows({ configStore, ai, tasks });
  assert.equal(res.tasks[0].classifyStatus, 'failed');
  assert.match(res.tasks[0].classifyError, /AI分类失败/);
  assert.equal(res.errors.length, 1);
});

// 追加：AI 返回不可解析文本（parseAiJsonContent 解析为 null）→ 候选任务 failed
test('classifyMissingRows AI 返回不可解析文本置 failed', async () => {
  const configStore = { getConfig: () => ({ ai_assignments: { classifier: '__current__' } }), getStyles: () => STYLES };
  const ai = {
    resolveAiSettings: () => ({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', retry_times: 0 }),
    chatCompletion: async () => ({ text: '你好', raw: null })
  };
  const tasks = [{ bookId: '1', style: '' }];
  const res = await classifyMissingRows({ configStore, ai, tasks });
  assert.equal(res.tasks[0].classifyStatus, 'failed');
  assert.match(res.tasks[0].classifyError, /未覆盖或无法解析/);
  assert.equal(res.errors.length, 1);
});
