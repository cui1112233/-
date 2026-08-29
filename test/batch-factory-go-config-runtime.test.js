const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const batchFactorySource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'batch-factory.js'), 'utf8');
const productionSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'batch-factory-production.js'), 'utf8');

test('Batch Factory runtime 不再导入 Node config-version 业务解析器', () => {
  assert.doesNotMatch(batchFactorySource, /listBatchFactoryConfigVersions/);
  assert.doesNotMatch(batchFactorySource, /resolveVersionedPreset/);
  assert.doesNotMatch(batchFactorySource, /resolveVersionedSystemPresetBody/);
  assert.doesNotMatch(productionSource, /resolveVersionedSystemPresetBody/);
  assert.doesNotMatch(batchFactorySource, /resolveSystemPresetBody/);
  assert.doesNotMatch(productionSource, /resolveSystemPresetBody/);
});

test('prompt catalog 和新批次冻结配置由 Go snapshot bridge 提供', () => {
  assert.match(batchFactorySource, /resolveConfigCatalogWithGo/);
  assert.match(batchFactorySource, /configCatalog\s*=\s*await\s+resolveConfigCatalogWithGo/);
  assert.match(batchFactorySource, /latestConfigSettingsWithGo/);
  assert.match(batchFactorySource, /systemConfigRevision:\s*latest\.revision/);
  assert.match(batchFactorySource, /systemPresetVersions:\s*latest\.presetVersions/);
});

test('导演系统 Prompt 和版本元数据通过 Go preset resolver', () => {
  assert.match(batchFactorySource, /resolvePresetBodyWithGo/);
  assert.match(batchFactorySource, /resolvePresetWithGo/);
  assert.match(batchFactorySource, /generateHook[\s\S]*await\s+systemPresetBodyWithGo/);
  assert.match(batchFactorySource, /generateDirector[\s\S]*await\s+directorSystemPrompt/);
  assert.match(batchFactorySource, /promptVersions[\s\S]*await\s+presetVersionWithGo/);
});

test('手动 VIDEO 编译和生产编译都通过 Go 解析前缀 preset', () => {
  assert.match(batchFactorySource, /videos\/:videoId\/compile[\s\S]*await\s+systemPresetBodyWithGo/);
  assert.match(productionSource, /resolvePresetBodyWithGo/);
  assert.match(productionSource, /async function compileItemVideos/);
  assert.match(productionSource, /await\s+resolvePresetBodyWithGo/);
  assert.match(productionSource, /videos\s*=\s*await\s+compileItemVideos/);
});
