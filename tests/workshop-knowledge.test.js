// 改文工作台：知识库数据层测试
// 覆盖：list/save/remove/summary 往返（临时目录落盘）、规则库只读、AI 优化写回（stub ai）。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const assert = require('node:assert');
const { createKnowledgeStore, RULE_KINDS } = require('../lib/novel-fetch-workshop/knowledge');

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-workshop-knowledge-'));

test('list 空库返回默认结构；save 追加生成 id；同 id 覆盖', () => {
  const store = createKnowledgeStore({ systemDir: makeTempDir() });
  const empty = store.list('high_imitation');
  assert.deepEqual(empty.items, []);
  assert.equal(empty.source, 'website');

  const r1 = store.save('high_imitation', { title: '标题A', source: '来源A', style: '现代虐文', content: '内容A' });
  assert.ok(r1.item.id);
  const r2 = store.save('high_imitation', { id: r1.item.id, title: '标题B', source: '来源B', style: '现代虐文', content: '内容B' });
  assert.equal(r2.item.id, r1.item.id);
  const items = store.list('high_imitation').items;
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '标题B');
});

test('三种知识库各自独立落盘，新实例可读回', () => {
  const dir = makeTempDir();
  const store = createKnowledgeStore({ systemDir: dir });
  store.save('high_imitation', { title: 't', source: 's', style: '现代虐文', content: 'c' });
  store.save('opening_phrases', { text: '她推开门', style: '现代悬疑', tags: ['钩子'], source: 'ai' });
  store.save('rewrite_templates', { name: '改文大师', style: '现代虐文', prompt: '请改写' });
  assert.equal(store.list('high_imitation').items.length, 1);
  assert.equal(store.list('opening_phrases').items.length, 1);
  assert.equal(store.list('rewrite_templates').items.length, 1);
  const reopened = createKnowledgeStore({ systemDir: dir });
  assert.equal(reopened.list('opening_phrases').items[0].text, '她推开门');
  assert.equal(reopened.list('opening_phrases').items[0].tags[0], '钩子');
});

test('remove 按 id 删除；不存在的 id 返回 removed=false', () => {
  const store = createKnowledgeStore({ systemDir: makeTempDir() });
  const r = store.save('opening_phrases', { text: 'x', style: '现代虐文', tags: [], source: 'website' });
  assert.equal(store.remove('opening_phrases', '不存在').removed, false);
  assert.equal(store.remove('opening_phrases', r.item.id).removed, true);
  assert.equal(store.list('opening_phrases').items.length, 0);
});

test('getSummary 统计各库条目数（含规则库）', () => {
  const store = createKnowledgeStore({ systemDir: makeTempDir() });
  store.save('high_imitation', { title: 't1', source: 's1', style: '现代虐文', content: 'c1' });
  store.save('high_imitation', { title: 't2', source: 's2', style: '现代甜文', content: 'c2' });
  const summary = store.getSummary();
  assert.equal(summary.high_imitation, 2);
  assert.equal(summary.opening_phrases, 0);
  assert.equal(summary.rewrite_templates, 0);
  for (const kind of RULE_KINDS) {
    assert.ok(typeof summary[kind] === 'number' && summary[kind] >= 0);
  }
});

test('规则库只读：list 返回 rules-knowledge 种子；save/remove 拒绝', () => {
  const store = createKnowledgeStore({ systemDir: makeTempDir() });
  const layout = store.list('layout_rules');
  assert.ok(layout && typeof layout === 'object');
  assert.throws(() => store.save('layout_rules', { a: 1 }), /资料库类型无效/);
  assert.throws(() => store.remove('symbol_rules', 'x'), /资料库类型无效/);
  assert.throws(() => store.list('unknown_kind'), /资料库类型无效/);
});

test('optimizeItem 用 stub ai 返回 JSON 优化并写回（保留 id）', async () => {
  const dir = makeTempDir();
  const store = createKnowledgeStore({ systemDir: dir });
  const saved = store.save('high_imitation', { title: '原标题', source: '参考', style: '现代虐文', content: '原内容' });
  // 返回带 ```json 围栏的 JSON，走默认 parseAiJsonContent 解析
  const ai = {
    chatCompletion: async () => ({ text: '```json\n{"item":{"title":"优化标题","style":"现代虐文","content":"优化后的内容","source":"参考"}}\n```', raw: {} })
  };
  const result = await store.optimizeItem({ kind: 'high_imitation', id: saved.item.id }, ai, { model: 'stub' });
  assert.equal(result.item.id, saved.item.id);
  assert.equal(result.item.title, '优化标题');
  const after = store.list('high_imitation').items;
  assert.equal(after.length, 1);
  assert.equal(after[0].title, '优化标题');
  assert.equal(after[0].content, '优化后的内容');
});

test('optimizeItem AI 返回格式错误抛错且不写库', async () => {
  const store = createKnowledgeStore({ systemDir: makeTempDir() });
  const saved = store.save('opening_phrases', { text: '原文', style: '现代虐文', tags: [], source: 'website' });
  const ai = { chatCompletion: async () => ({ text: '不是 JSON', raw: {} }) };
  await assert.rejects(() => store.optimizeItem({ kind: 'opening_phrases', id: saved.item.id }, ai, {}), /AI返回格式不正确/);
  assert.equal(store.list('opening_phrases').items[0].text, '原文');
});
