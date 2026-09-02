const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const app = fs.readFileSync(path.join(__dirname, '..', 'frontend/public/batch-rewrite/app.js'), 'utf8');
const uploadRoute = fs.readFileSync(path.join(__dirname, '..', 'routes/novel-fetch-upload.js'), 'utf8');
const rewriteRoute = fs.readFileSync(path.join(__dirname, '..', 'routes/batch-rewrite.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'frontend/public/batch-rewrite/index.html'), 'utf8');
const v2App = fs.readFileSync(path.join(__dirname, '..', 'public/batch-rewrite/v78-novel-fetch-v2.js'), 'utf8');

test('121 登录验证必须有超时并在结束时恢复按钮', () => {
  assert.match(app, /const PLATFORM_API_TIMEOUT_MS = \d+;/);
  assert.match(app, /new AbortController\(\)/);
  assert.match(app, /signal:\s*controller\.signal/);
  assert.match(app, /验证请求超时，请检查网络后重试/);
  assert.match(app, /webLoginSubmit"\)\.disabled = false/);
  assert.match(app, /novelFetchPlatformApi\("\/api\/novel-fetch-upload\/upload-login"/);
});

test('121 会话验证使用同一超时封装并在 finally 中恢复按钮', () => {
  assert.match(app, /novelFetchPlatformApi\("\/api\/batch-rewrite\/web-submit\/test-visible"/);
  assert.match(app, /finally\s*\{[\s\S]*button\.disabled = false;/);
});

test('登录弹窗在配置尚未加载时也能收口，不会因空配置永久停在验证中', () => {
  assert.match(app, /\.\.\.\(state\.config\?\.web_submit \|\| \{\}\)/);
  assert.match(app, /webLoginSubmit"\)\.disabled = false/);
  assert.match(app, /dialog\.addEventListener\("submit"/);
});

test('服务端 121 登录和会话验证显式设置超时', () => {
  assert.match(uploadRoute, /timeoutMs:\s*15000/);
  assert.match(rewriteRoute, /timeoutMs:\s*15000/);
});

test('处理页直接选择原文和 AI1-AI5，输入框始终保留', () => {
  for (const version of ['original', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5']) {
    assert.match(html, new RegExp(`class="process-version" value="${version}"`));
  }
  assert.match(html, /<textarea id="inputText"/);
  assert.doesNotMatch(app, /inputText[^\n]*remove\(/);
});

test('处理页以版本配置替代解析输入，并提供两种 121 同步入口', () => {
  const workPanel = html.match(/<section id="work"[\s\S]*?<section id="tasks"/)?.[0] || '';
  assert.match(workPanel, /版本配置/);
  assert.match(workPanel, /同步批量后台配置/);
  assert.match(workPanel, /同步批量风格类型/);
  assert.doesNotMatch(workPanel, /输入格式|列顺序预设|自定义列顺序/);
  assert.doesNotMatch(app, /正在解析输入内容/);
});

test('配置页不再用 AI 数量或重复优先方案控制本次处理', () => {
  assert.doesNotMatch(html, /aiCountDefault|aiCountMax|默认AI文案数量|最大AI文案数量/);
  assert.doesNotMatch(html, /id="aiSlotMethods"/);
  assert.doesNotMatch(app, /default_ai_count|max_ai_count|readAiSlotMethods/);
  assert.doesNotMatch(v2App, /ai_count|v78AiCount|batch-ai-count/);
});

test('版本对应配置档保留并覆盖 AI4、AI5，提交页不再二次选择版本', () => {
  assert.match(html, /版本对应配置档/);
  assert.match(html, /id="webProfileBindingAi4"/);
  assert.match(html, /id="webProfileBindingAi5"/);
  assert.doesNotMatch(html, /class="web-version"/);
  assert.match(rewriteRoute, /const versions = versionSelection\.taskSelectedVersions\(task\.meta\)/);
  assert.doesNotMatch(rewriteRoute, /body\?\.versions/);
});

test('处理规则提示词与知识库使用提示词都有独立保存字段', () => {
  assert.match(html, /id="processingRulePrompt"/);
  assert.match(html, /id="knowledgeUsagePrompt"/);
  assert.match(app, /processing_rule_prompt/);
  assert.match(app, /usage_prompt/);
});
