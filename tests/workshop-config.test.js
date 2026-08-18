const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const assert = require('node:assert');
const { createWorkshopConfigStore } = require('../lib/novel-fetch-workshop/config');

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-workshop-'));

test('工作台配置初始化为默认值并可持久化补丁', t => {
  const dir = makeTempDir();
  const store = createWorkshopConfigStore({ systemDir: dir });
  const cfg = store.getConfig();
  assert.equal(cfg.fetch.default_max_txt, 4000);
  assert.equal(cfg.ai.api_key, '');
  assert.equal(cfg.rewrite.process_line_count, 5);
  assert.equal(cfg.sensitive_ai.context_chars, 12);
  store.saveConfig({ rewrite: { process_line_count: 8 } });
  const reloaded = createWorkshopConfigStore({ systemDir: dir }).getConfig();
  assert.equal(reloaded.rewrite.process_line_count, 8);
  assert.equal(reloaded.fetch.default_max_txt, 4000); // 其余默认保持
});

test('平台表与风格表从常量种子化', t => {
  const store = createWorkshopConfigStore({ systemDir: makeTempDir() });
  assert.ok(store.getPlatforms().length >= 10);
  assert.ok(store.getStyles().includes('现代女主'));
});

test('ai 配置独立保存（含 ai_presets 与 ai_assignments）', t => {
  const dir = makeTempDir();
  const store = createWorkshopConfigStore({ systemDir: dir });
  store.saveAiConfig({ ai: { model: 'm1' }, ai_presets: [{ id: 'p1', name: '预设1' }], ai_assignments: { classifier: 'p1' } });
  const reloaded = createWorkshopConfigStore({ systemDir: dir }).getAiConfig();
  assert.equal(reloaded.ai.model, 'm1');
  assert.equal(reloaded.ai_presets[0].id, 'p1');
  assert.equal(reloaded.ai_assignments.classifier, 'p1');
  assert.equal(createWorkshopConfigStore({ systemDir: dir }).getConfig().ai.model, 'm1');
});
