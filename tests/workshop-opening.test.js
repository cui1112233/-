// 改文工作台：爆款开头词模块测试
// 覆盖：analyze 用 stub ai 拆解为可入库条目、save 落盘与按 id 覆盖、
// normalize 按 text 去重并按 style 归类（临时目录落盘，不污染 data/system）。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const assert = require('node:assert');
const { createOpeningStore, normalizeOpeningStyle } = require('../lib/novel-fetch-workshop/opening');
const { createKnowledgeStore } = require('../lib/novel-fetch-workshop/knowledge');

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-workshop-opening-'));

test('analyze 用 stub ai 把爆款开头拆解为可入库条目', async () => {
  const store = createOpeningStore({ systemDir: makeTempDir() });
  const ai = {
    chatCompletion: async () => ({
      text: JSON.stringify({ template_name: '悬疑钩子', general_phrase: '她推开那扇门，里面传来……', style: '现代悬疑', tags: ['悬疑', '钩子'] }),
      raw: {}
    })
  };
  const result = await store.analyze(ai, { model: 'stub' }, '她推开那扇门，里面传来一声轻响。');
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.items));
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.ok(item.id);
  assert.equal(item.text, '她推开那扇门，里面传来……');
  assert.equal(item.style, '现代悬疑');
  assert.deepEqual(item.tags, ['悬疑', '钩子']);
  assert.equal(item.source, 'website');
});

test('analyze 原文为空抛错', async () => {
  const store = createOpeningStore({ systemDir: makeTempDir() });
  await assert.rejects(() => store.analyze({ chatCompletion: async () => ({ text: 'x' }) }, {}, ''), /请先粘贴爆款开头原文/);
});

test('save 落盘并可按 id 覆盖（经 knowledge 层读回同一文件）', () => {
  const dir = makeTempDir();
  const store = createOpeningStore({ systemDir: dir });
  const r1 = store.save({ text: '她推开那扇门', style: '现代悬疑', tags: ['悬疑'] });
  assert.ok(r1.item.id);
  store.save({ id: r1.item.id, text: '改写后的开头词', style: '现代虐文', tags: ['虐文'] });
  const knowledge = createKnowledgeStore({ systemDir: dir });
  const items = knowledge.list('opening_phrases').items;
  assert.equal(items.length, 1);
  assert.equal(items[0].text, '改写后的开头词');
  assert.equal(items[0].style, '现代虐文');
});

test('save 空内容抛错', () => {
  const store = createOpeningStore({ systemDir: makeTempDir() });
  assert.throws(() => store.save({ text: '   ' }), /开头词内容不能为空/);
});

test('normalize 按 text 去重并按 style 归类', () => {
  const dir = makeTempDir();
  const store = createOpeningStore({ systemDir: dir });
  store.save({ text: '重复开头词', style: '现代虐文', tags: ['a'] });
  store.save({ text: '重复开头词', style: '现代甜文', tags: ['b'] }); // 与上一条 text 重复
  store.save({ text: '唯一开头词', style: '现代悬疑', tags: ['c'] });
  const result = store.normalize();
  assert.equal(result.ok, true);
  assert.equal(result.removed, 1);
  assert.deepEqual(Object.keys(result.grouped).sort(), ['现代悬疑', '现代虐文']);
  assert.equal(result.grouped['现代虐文'].length, 1);
  assert.equal(result.grouped['现代悬疑'].length, 1);
  // 落盘后去重生效
  const knowledge = createKnowledgeStore({ systemDir: dir });
  assert.equal(knowledge.list('opening_phrases').items.length, 2);
});

test('normalizeOpeningStyle 风格归一（精确/包含/别名/兜底）', () => {
  assert.equal(normalizeOpeningStyle('现代虐文', []), '现代虐文');
  assert.equal(normalizeOpeningStyle('现代女频', []), '现代女主');
  assert.equal(normalizeOpeningStyle('古风虐', []), '古风虐文');
  assert.equal(normalizeOpeningStyle('男频', []), '男频都市');
  assert.equal(normalizeOpeningStyle('随便什么', ['现代通用']), '现代通用');
  assert.equal(normalizeOpeningStyle('', []), '');
});
