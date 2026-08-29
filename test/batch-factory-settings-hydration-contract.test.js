const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('Batch Factory 应用入口使用共享 settings-aware store', () => {
  assert.match(appSource, /createSettingsAwareBatchFactoryStore/);
  assert.match(appSource, /const resolvedBatchFactoryStore = createSettingsAwareBatchFactoryStore\(\)/);
  assert.match(appSource, /createBatchFactoryIntakeRouter\(\{ store: resolvedBatchFactoryStore \}\)/);
  assert.match(appSource, /createBatchFactoryControlsRouter\(\{ store: resolvedBatchFactoryStore, shuihuoGateway \}\)/);
  assert.match(appSource, /createBatchFactoryRouter\(\{[\s\S]*store: resolvedBatchFactoryStore,[\s\S]*shuihuoGateway,[\s\S]*\}\)/);
  assert.match(appSource, /createBatchFactoryProductionRouter\(\{ store: resolvedBatchFactoryStore, presetStore: resolvedPresetStore, shuihuoGateway \}\)/);
});

test('Go settings hydration middleware 挂载在所有 Batch Factory 业务路由之前', () => {
  assert.match(appSource, /createBatchFactorySettingsHydrationRouter/);
  const hydration = appSource.indexOf("app.use('/api/batch-factory', createBatchFactorySettingsHydrationRouter");
  const intake = appSource.indexOf("app.use('/api/batch-factory', createBatchFactoryIntakeRouter");
  const controls = appSource.indexOf("app.use('/api/batch-factory', createBatchFactoryControlsRouter");
  const director = appSource.indexOf("app.use('/api/batch-factory', createBatchFactoryRouter");
  const production = appSource.indexOf("app.use('/api/batch-factory', createBatchFactoryProductionRouter");
  assert.ok(hydration >= 0, 'hydration middleware missing');
  for (const [name, position] of Object.entries({ intake, controls, director, production })) {
    assert.ok(position > hydration, `${name} must be mounted after hydration`);
  }
});
