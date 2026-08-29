const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const hydrationSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'batch-factory-settings-hydration.js'), 'utf8');
const controlsSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'batch-factory-controls.js'), 'utf8');

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

test('批次列表在冷缓存时也会从 Go/MySQL hydrate，而不是直接返回 legacy JSON settings', () => {
  assert.match(hydrationSource, /req\.method === ['"]GET['"][\s\S]*req\.path === ['"]\/batches['"]/);
  assert.match(hydrationSource, /store\.listBatches\(req\.username\)/);
  assert.match(hydrationSource, /hydrateBatchList\(/);
});

test('保存统一设置和 sparse override 成功后会清理对应批次 settings cache', () => {
  assert.match(controlsSource, /clearPersistedSettingsStateCache/);
  const clears = controlsSource.match(/clearPersistedSettingsStateCache\(req\.auth\.account\.username, batch\.id\)/g) || [];
  assert.ok(clears.length >= 3, `expected cache clear after batch/item/video saves, got ${clears.length}`);
});
