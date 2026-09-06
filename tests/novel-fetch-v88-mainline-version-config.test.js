const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `missing async function ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart + 1, index);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

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
  assert.match(app, /selected_versions/);
  assert.match(app, /ai_slot_methods/);
  assert.match(app, /cfg\.submit_versions = selectedProcessVersions\(\)/);
  assert.match(app, /renderVersionPromptConfig/);
  assert.match(app, /syncVersionPromptConfigToForm/);
});

test('版本对应配置档通过单一权威接口一次保存并立即采用服务端回读配置', () => {
  const app = fs.readFileSync(path.join(root, 'frontend/public/batch-rewrite/app.js'), 'utf8');
  const handler = functionBody(app, 'confirmWebSubmitSelection');
  const authority = functionBody(app, 'saveVersionConfigAuthority');

  assert.match(handler, /await saveVersionConfigAuthority\(\)/);
  assert.doesNotMatch(handler, /saveWorkFormStateNow\(/);
  assert.doesNotMatch(handler, /saveConfig\(/);
  assert.doesNotMatch(handler, /saveWebSubmitConfig\(/);

  assert.match(authority, /clearTimeout\(workFormSaveTimer\)/);
  assert.match(authority, /const formState = collectWorkFormState\(\)/);
  assert.match(authority, /appConfig\.work_form = formState/);
  assert.match(authority, /appConfig\.web_submit = syncFormToWebSubmitConfig\(\)/);
  assert.match(authority, /api\(["']\/api\/config["']/);
  assert.match(authority, /body:\s*JSON\.stringify\(\{\s*app_config:\s*appConfig\s*\}\)/);
  assert.match(authority, /state\.config = result\.config/);
  assert.match(authority, /localStorage\.setItem\(WORK_FORM_STORAGE_KEY/);
});

test('V88 /config 是版本配置档的单次持久化权威入口，可同时写入 work_form 与 web_submit', () => {
  const route = fs.readFileSync(path.join(root, 'routes/batch-rewrite.js'), 'utf8');
  assert.match(route, /\.\.\.\(object\(body\.app_config\)\)/);
  assert.match(route, /await tasks\.saveConfig\(next\)/);
  assert.match(route, /router\.post\('\/config'/);
  assert.match(route, /work_form:\s*current\.work_form\s*\|\|\s*\{\}/);
  assert.match(route, /web_submit:\s*publicWebSubmit\(current\.web_submit\)/);
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