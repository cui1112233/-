// 改文工作台：改文引擎测试
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const assert = require('node:assert');
const { createWorkshopTasks } = require('../lib/novel-fetch-workshop/tasks');
const { methodForAiIndex, splitLines, buildRewriteMessages, buildHighImitationMessages, extractAiChangedText, mergeChangedBlockWithOriginal, generateAiVersion, generateAiVersions } = require('../lib/novel-fetch-workshop/rewrite');

test('methodForAiIndex 轮换循环', () => {
  const seq = ['high_imitation', 'opening_instruction', 'instruction'];
  assert.equal(methodForAiIndex(seq, 1), 'high_imitation');
  assert.equal(methodForAiIndex(seq, 2), 'opening_instruction');
  assert.equal(methodForAiIndex(seq, 3), 'instruction');
  assert.equal(methodForAiIndex(seq, 4), 'high_imitation');
  assert.equal(methodForAiIndex(seq, 5), 'opening_instruction');
});

test('methodForAiIndex 别名归一', () => {
  assert.equal(methodForAiIndex(['high'], 1), 'high_imitation');
  assert.equal(methodForAiIndex(['mimic'], 1), 'high_imitation');
  assert.equal(methodForAiIndex(['高仿'], 1), 'high_imitation');
  assert.equal(methodForAiIndex(['opening'], 1), 'opening_instruction');
  assert.equal(methodForAiIndex(['开头词'], 1), 'opening_instruction');
  assert.equal(methodForAiIndex(['指令'], 1), 'instruction');
  // 空序列回退默认轮换序列
  assert.equal(methodForAiIndex([], 1), 'high_imitation');
  assert.equal(methodForAiIndex(undefined, 1), 'high_imitation');
});

test('splitLines 拆分目标块与锚点', () => {
  const { targetLines, anchorLines, fullText } = splitLines('a\nb\nc\nd\ne\nf\ng\n', { processLineCount: 3, anchorLineCount: 2 });
  assert.deepEqual(targetLines, ['a','b','c']);
  assert.deepEqual(anchorLines, ['d','e']);
  assert.ok(fullText.includes('a\nb\nc'));
});

test('buildRewriteMessages 指令改文构造含 extra_instruction 与输出要求', () => {
  const config = { rewrite: { prompt: '你是短视频小说正文改写师。请只根据原文、风格类型和男女频改写开头部分，保留故事事实、人物关系、时代背景和后续衔接。输出正文，不要解释。', temperature: 0.45 } };
  const [system, user] = buildRewriteMessages({ strategy: 'instruction', config, task: { bookId: '1', style: '现代虐文', gender: '女频' }, targetLines: ['行一'], anchorLines: ['锚点'], fullText: '行一\n锚点', aiIndex: 1 });
  assert.match(system.content, /短视频小说正文改写师/);
  const parsed = JSON.parse(user.content);
  assert.equal(parsed.book_id, '1');
  assert.equal(parsed.line_count, 1);
  assert.match(parsed.extra_instruction, /第 1 个AI文案/);
  assert.equal(parsed.output, '只输出改写后的正文，不要解释。');
});

test('buildHighImitationMessages 高仿改文构造含无匹配参考文案', () => {
  const config = { rewrite: { prompt: 'p', temperature: 0.45 } };
  const [system, user] = buildHighImitationMessages({ config, task: { bookId: '2', style: '男频都市', gender: '男频' }, targetLines: ['a'], anchorLines: ['b'], fullText: 'a\nb', aiIndex: 1 });
  assert.match(system.content, /拆解参考文案/);
  const parsed = JSON.parse(user.content);
  assert.match(parsed.reference, /没有匹配参考文案/);
  assert.ok(parsed.return_format.changed_lines);
});

test('extractAiChangedText 解析 changed_lines JSON', () => {
  const { text, responseMode } = extractAiChangedText(JSON.stringify({ id: '1', changed_lines: [{ line_no: 1, text: '改写内容' }] }));
  assert.equal(text, '改写内容');
  assert.equal(responseMode, 'changed_lines');
});

test('extractAiChangedText 纯文本兜底', () => {
  const { text, responseMode } = extractAiChangedText('直接输出正文');
  assert.equal(text, '直接输出正文');
  assert.equal(responseMode, 'plain');
});

test('mergeChangedBlockWithOriginal 删前块插入改写块', () => {
  const out = mergeChangedBlockWithOriginal(['a','b','c','d','e'], ['A','B'], { processLineCount: 3 });
  assert.equal(out, 'A\nB\nd\ne');
});

// ===== generateAiVersion 集成测试（mock tasks/ai/configStore）=====

function makeTasksStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-workshop-rewrite-'));
  const store = createWorkshopTasks({
    usersDir: dir,
    fetchUpstream: async () => ({ text: '第一行\n第二行\n第三行\n第四行\n第五行\n第六行\n', bookinfo: {} })
  });
  return { dir, store };
}

function makeRewriteConfigStore() {
  return {
    getAiConfig: () => ({ ai: { base_url: 'https://x/v1', api_key: 'k', model: 'm' }, ai_presets: [], ai_assignments: { rewrite: '__current__' } }),
    getConfig: () => ({
      rewrite: {
        prompt: '你是短视频小说正文改写师。请只根据原文、风格类型和男女频改写开头部分，保留故事事实、人物关系、时代背景和后续衔接。输出正文，不要解释。',
        temperature: 0.45,
        process_line_count: 3,
        anchor_line_count: 2,
        method_sequence: ['high_imitation', 'opening_instruction', 'instruction']
      }
    })
  };
}

function makeMockAi(text) {
  return {
    resolveAiSettings: () => ({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' }),
    chatCompletion: async () => ({ text, raw: {} })
  };
}

test('generateAiVersion 成功生成版本并更新 meta/日志/版本文件', async () => {
  const { store } = makeTasksStore();
  await store.saveTasks('u1', [{ bookId: '1001', bookName: '书名', style: '现代虐文', gender: '女频' }]);
  await store.fetchOriginal('u1', '1001', 4000);

  const configStore = makeRewriteConfigStore();
  const ai = makeMockAi('改写第一行\n改写第二行');
  const task = store.getTask('u1', '1001').meta;
  const res = await generateAiVersion({ configStore, tasks: store, username: 'u1', task, aiIndex: 1, count: 1, ai });

  assert.equal(res.status, 'done');
  assert.equal(res.versionText, '改写第一行\n改写第二行\n第四行\n第五行\n第六行');
  assert.equal(store.readVersionText('u1', '1001', 'ai1'), res.versionText);

  const meta = store.getTask('u1', '1001').meta;
  assert.equal(meta.aiStatus, 'done');
  assert.equal(meta.aiGeneratedCount, 1);
  assert.equal(meta.rewriteKnowledge.strategy, 'high_imitation'); // ai1 → 序列首位
  assert.equal(meta.rewriteKnowledge.aiIndex, 1);
  assert.equal(meta.rewriteKnowledge.responseMode, 'plain');
  assert.deepEqual(meta.rewriteKnowledge.patch, { deleteLineCount: 3, changedLineCount: 2, finalLineCount: 5 });

  const logs = store.readLogs('u1', '1001');
  assert.ok(logs.some(log => log.event === 'ai_generated'));
});

test('generateAiVersion 原文未就绪返回 waiting_original', async () => {
  const { store } = makeTasksStore();
  await store.saveTasks('u1', [{ bookId: '1002', bookName: '书名', style: '现代虐文', gender: '女频' }]);
  // 未抓原文：originalStatus 为空
  const configStore = makeRewriteConfigStore();
  const ai = makeMockAi('x');
  const task = store.getTask('u1', '1002').meta;
  const res = await generateAiVersion({ configStore, tasks: store, username: 'u1', task, aiIndex: 1, count: 1, ai });
  assert.equal(res.status, 'waiting_original');
  assert.equal(store.getTask('u1', '1002').meta.aiStatus, 'waiting_original');
});

test('generateAiVersions 聚合状态：部分失败 partial', async () => {
  const { store } = makeTasksStore();
  await store.saveTasks('u1', [{ bookId: '1003', bookName: '书名', style: '现代虐文', gender: '女频' }]);
  await store.fetchOriginal('u1', '1003', 4000);

  // ai1 成功、ai2 失败 → 整体 partial
  let calls = 0;
  const ai = {
    resolveAiSettings: () => ({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' }),
    chatCompletion: async () => {
      calls++;
      if (calls === 1) return { text: '改写第一版', raw: {} };
      throw new Error('上游失败');
    }
  };
  const configStore = makeRewriteConfigStore();
  const task = store.getTask('u1', '1003').meta;
  const res = await generateAiVersions({ configStore, tasks: store, username: 'u1', task, count: 2, ai });
  assert.equal(res.status, 'partial');
  assert.equal(res.generated.length, 2);
  assert.equal(res.generated[0].status, 'done');
  assert.equal(res.generated[1].status, 'failed');
  assert.match(res.error, /上游失败/);
});
