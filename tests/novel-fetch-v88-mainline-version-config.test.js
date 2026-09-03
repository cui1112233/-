const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('V88 正式小说获取主页面使用版本配置入口，不再显示旧解析入口', () => {
  const html = fs.readFileSync(path.join(root, 'frontend/public/batch-rewrite/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'frontend/public/batch-rewrite/app.js'), 'utf8');

  for (const id of ['versionConfigBtn', 'versionConfigCard', 'processBtn', 'syncWebProfilesBtn', 'syncWebStylesBtn', 'webProfileBindingAi5', 'versionConfigRewritePrompt', 'versionConfigProcessingRulePrompt', 'versionConfigKnowledgeUsagePrompt']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /版本对应配置档/);
  assert.match(html, /AI5/);
  assert.doesNotMatch(html, /id=["']parseModeSelect["']/);
  assert.doesNotMatch(html, /id=["']columnPresetSelect["']/);
  assert.doesNotMatch(html, /id=["']aiCountDefault["']/);
  assert.match(app, /await saveWebSubmitConfig\(true\)/);
  assert.match(app, /selected_versions/);
  assert.match(app, /ai_slot_methods/);
  assert.match(app, /cfg\.submit_versions = selectedProcessVersions\(\)/);
  assert.match(app, /renderVersionPromptConfig/);
  assert.match(app, /syncVersionPromptConfigToForm/);
  assert.match(app, /await saveConfig\(true\)/);
});

test('V88 V2 将主页面版本选择转换为 target_versions，并拒绝空选择', () => {
  const { normalizeProcessPayload } = require('../lib/novel-fetch-workshop/v2-api-contract');
  const payload = normalizeProcessPayload({
    input_text: 'book-1',
    selected_versions: ['AI5', 'original', 'ai5'],
    ai_slot_methods: { ai5: 'instruction' }
  });
  assert.deepEqual(payload.target_versions, ['original', 'ai5']);
  assert.deepEqual(payload.ai_slot_methods_snapshot, { ai5: 'instruction' });
  assert.equal('selected_versions' in payload, false);
  assert.equal('ai_slot_methods' in payload, false);

  assert.throws(
    () => normalizeProcessPayload({ input_text: 'book-1', selected_versions: [] }),
    error => error?.status === 400 && error?.message === '请至少选择一个文案版本'
  );
});

test('V88 121 配置档可以保存 AI4 和 AI5 的版本绑定', () => {
  const service = fs.readFileSync(path.join(root, 'lib/novel-fetch-workshop/121-web-submit-service.js'), 'utf8');
  assert.match(service, /\['original',\s*'ai1',\s*'ai2',\s*'ai3',\s*'ai4',\s*'ai5'\]/);
  assert.match(service, /profile_bindings:\s*normalizeProfileBindings/);
});
