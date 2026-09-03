const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('版本集合固定为原文和 AI1 到 AI5，并保留稀疏选择', () => {
  const selection = require('../lib/novel-fetch-workshop/version-selection');
  assert.deepEqual(selection.VERSION_ORDER, ['original', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5']);
  assert.deepEqual(selection.normalizeSelectedVersions(['AI5', 'ai1', 'ai5', 'invalid']), ['ai1', 'ai5']);
});

test('旧任务仍能从 aiCount 推导目标版本', () => {
  const selection = require('../lib/novel-fetch-workshop/version-selection');
  assert.deepEqual(selection.taskSelectedVersions({ aiCount: 2 }), ['original', 'ai1', 'ai2']);
});

test('版本对应配置档覆盖原文和 AI1 到 AI5，并丢弃未知版本', () => {
  const selection = require('../lib/novel-fetch-workshop/version-selection');
  assert.deepEqual(selection.normalizeProfileBindings({
    original: 'p-original',
    ai1: 'p-ai1',
    ai5: 'p-ai5',
    ai6: 'ignored'
  }), {
    original: 'p-original',
    ai1: 'p-ai1',
    ai5: 'p-ai5'
  });
});


test('版本处理配置保存后重新读取仍保留选择和槽位方案', async () => {
  const saved = {};
  const store = {
    async getTask() { return { meta: { bookId: 'book-1' } }; },
    async updateTaskMeta(_owner, _id, patch) { Object.assign(saved, patch); }
  };
  const { createNovelFetchTaskOps } = require('../lib/novel-fetch-workshop/task-ops');
  const ops = createNovelFetchTaskOps({
    accountResolver: owner => ({ username: owner }),
    createStore: () => store,
    tombstones: {},
    parseBooks: () => ({ tasks: [] }),
    applySavedRules: async () => {},
    createConfigSnapshot: () => ({})
  });
  const result = await ops.setSelectedVersions(
    'alice',
    ['book-1'],
    ['original', 'ai5', 'ai2'],
    { ai5: 'instruction', ai2: 'opening_instruction' }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(saved.targetVersions, ['original', 'ai2', 'ai5']);
  assert.deepEqual(saved.selectedVersions, ['original', 'ai2', 'ai5']);
  assert.deepEqual(saved.aiSlotMethodsSnapshot, {
    ai2: 'opening_instruction',
    ai5: 'instruction'
  });
});

test('主线工作区是版本配置入口，不再保留旧解析入口', () => {
  const html = fs.readFileSync(path.join(root, 'frontend/public/batch-rewrite/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'frontend/public/batch-rewrite/app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'frontend/public/batch-rewrite/styles.css'), 'utf8');
  const distHtml = fs.readFileSync(path.join(root, 'frontend/dist/batch-rewrite/index.html'), 'utf8');
  const distApp = fs.readFileSync(path.join(root, 'frontend/dist/batch-rewrite/app.js'), 'utf8');
  for (const label of ['版本对应配置档', '同步批量后台配置', '同步批量风格类型', 'AI5']) {
    assert.match(html, new RegExp(label));
  }
  assert.doesNotMatch(html, /解析格式|列顺序|默认AI文案数量|id=["']parseModeSelect["']/);
  for (const id of ['versionConfigBtn', 'versionConfigCard', 'syncWebProfilesBtn', 'syncWebStylesBtn', 'webProfileBindingOriginal', 'webProfileBindingAi5', 'processBtn']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(styles, /\.version-config-card/);
  assert.match(distHtml, /版本对应配置档/);
  assert.match(distHtml, /同步批量后台配置/);
  assert.match(distApp, /selected_versions/);
  assert.match(app, /openVersionConfigCard/);
  assert.match(app, /closeVersionConfigCard/);
  assert.match(app, /processBtn/);
  assert.match(app, /await saveWebSubmitConfig\(true\)/);
  assert.match(app, /profile_bindings/);
  assert.equal(app.includes("/api/parse"), false);
  assert.match(app, /selected_versions/);
  assert.match(app, /ai_slot_methods/);
});
