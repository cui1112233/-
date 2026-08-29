const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'batch-factory.js'), 'utf8');

test('Batch Factory runtime 不再导入 Node director-output 业务解析器', () => {
  assert.doesNotMatch(source, /require\(['"]\.\.\/lib\/batch-factory\/director-output['"]\)/);
  assert.doesNotMatch(source, /\bnormalizeDirectorOutput\s*\(/);
  assert.doesNotMatch(source, /\bDIRECTOR_SCHEMA\b/);
});

test('hook 和 director runtime 使用 Go director bridge contract', () => {
  assert.match(source, /buildHookContractWithGo/);
  assert.match(source, /buildDirectorContractWithGo/);
  assert.match(source, /normalizeDirectorOutputWithGo/);
  assert.match(source, /const\s+contract\s*=\s*await\s+buildHookContractWithGo/);
  assert.match(source, /const\s+contract\s*=\s*await\s+buildDirectorContractWithGo/);
  assert.match(source, /contract\.systemPrompt/);
  assert.match(source, /contract\.userPrompt/);
  assert.match(source, /contract\.temperature/);
  assert.match(source, /contract\.maxTokens/);
});

test('director 模型输出和手动 director-result 都交给 Go canonicalize', () => {
  assert.match(source, /generateDirector[\s\S]*await\s+normalizeDirectorOutputWithGo/);
  assert.match(source, /director-result[\s\S]*await\s+normalizeDirectorOutputWithGo/);
  assert.match(source, /promptVersions:\s*contract\.promptVersions/);
});

test('Node 不再本地拼装 director system/user prompt 业务规则', () => {
  assert.doesNotMatch(source, /function\s+directorSystemPrompt\s*\(/);
  assert.doesNotMatch(source, /function\s+directorUserPrompt\s*\(/);
  assert.doesNotMatch(source, /function\s+selectedDirectorPromptsWithGo\s*\(/);
  assert.doesNotMatch(source, /function\s+prefixCatalogPrompt\s*\(/);
});
