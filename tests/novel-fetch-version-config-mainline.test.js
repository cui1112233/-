'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const routeSource = fs.readFileSync(path.join(root, 'routes/batch-rewrite.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'frontend/public/batch-rewrite/index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'frontend/public/batch-rewrite/app.js'), 'utf8');
const versionSelection = require('../lib/novel-fetch-workshop/version-selection');

test('版本配置 UI 已覆盖 original 与 AI1-AI5，并由开始处理请求提交选择', () => {
  for (const label of ['版本对应配置档', 'AI1', 'AI2', 'AI3', 'AI4', 'AI5', '同步批量后台配置', '同步批量风格类型']) {
    assert.match(htmlSource, new RegExp(label));
  }
  assert.match(appSource, /selected_versions:\s*versions/);
  assert.match(appSource, /ai_slot_methods:\s*processAiMethods\(\)/);
  assert.match(appSource, /profile_bindings:\s*webProfileBindingsFromForm\(\)/);
});

test('后端处理入口必须真正消费 selected_versions 与 ai_slot_methods，而不是只读 ai_count', () => {
  assert.match(routeSource, /normalizeTargetVersions\(\s*payload\?\.selected_versions/);
  assert.match(routeSource, /aiSlotMethodsSnapshot/);
  assert.match(routeSource, /targetVersions/);
});

test('版本配置档绑定必须覆盖 original 与 AI1-AI5', () => {
  const bindings = versionSelection.normalizeProfileBindings({ ai5: 'profile-5' });
  assert.deepEqual(Object.keys(bindings), ['original', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5']);
  assert.equal(bindings.ai5, 'profile-5');
});

test('单任务生成 AI 必须读取任务已选版本，而不是默认只生成一个 AI1', () => {
  const generateRoute = routeSource.match(/router\.post\('\/tasks\/:id\/generate-ai'[\s\S]*?\}\);/);
  assert.ok(generateRoute, 'generate-ai route not found');
  assert.match(generateRoute[0], /selected_versions/);
  assert.match(generateRoute[0], /ai_slot_methods/);
});
