const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isSupportedScriptVideoModel } = require('../routes/script-video');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('script page uses only configured enabled video models and has no legacy fallback', () => {
  const source = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(source, /listConfiguredModels\('video'\)/);
  assert.match(source, /filterEnabledModels\(configuredVideoModels, 'video'\)/);
  assert.match(source, /placeholder="请先启用视频模型"/);
  assert.doesNotMatch(source, /configuredVideoModels\.length \? [\s\S]*yd2-mini-video/);
});

test('batch factory selectors filter the shared catalog by enabled video capability', () => {
  const controls = read('frontend/src/user/pages/batch-factory/BatchFactoryProductionControls.jsx');
  const bulk = read('frontend/src/user/pages/batch-factory/BatchFactoryBulkProduction.jsx');
  assert.match(controls, /filterEnabledModels\(result\.models, 'video'\)/);
  assert.match(controls, /filterCompatibleVideoModels\(models, batch\)/);
  assert.match(bulk, /filterCompatibleVideoModels\(models, batch\)/);
});

test('script video route fails closed for configured models without an adapter', () => {
  assert.equal(isSupportedScriptVideoModel('yd2-mini-video'), true);
  assert.equal(isSupportedScriptVideoModel('local-doubao-executor-video'), true);
  assert.equal(isSupportedScriptVideoModel('h3'), false);
  assert.equal(isSupportedScriptVideoModel('custom-video'), false);
});
