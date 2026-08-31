import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as adapterModule from './bf11UiAdapter.js';
import { createBf11UiAdapter } from './bf11UiAdapter.js';
import { workbenchStateFromLoad } from './bf11Runtime.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(here, name), 'utf8');

test('loadWorkbench calls getConfigVersions and carries Go catalog unchanged', async () => {
  const calls = [];
  const catalog = [
    { id: 'cfg-old', name: '旧配置', createdAt: '2026-08-01T00:00:00Z' },
    { id: 'cfg-current', name: '当前配置', createdAt: '2026-08-31T00:00:00Z' }
  ];
  const adapter = createBf11UiAdapter({
    getCapabilities: async () => { calls.push('capabilities'); return {}; },
    getConfigVersions: async () => { calls.push('config-versions'); return { configVersions: catalog }; },
    listBatches: async () => ({ batches: [] })
  });
  const load = await adapter.loadWorkbench();
  assert.equal(calls[0], 'capabilities');
  assert.equal(calls.includes('config-versions'), true);
  assert.equal(load.configVersions, catalog);
  assert.equal(load.configVersionsError, null);
});

test('runtime exposes the server catalog without inventing a latest version', () => {
  const catalog = [
    { id: 'z-first-from-go', name: 'First' },
    { id: 'a-last-from-go', name: 'Last' }
  ];
  const state = workbenchStateFromLoad({ configVersions: catalog, configVersionsError: null });
  assert.equal(state.configVersions, catalog);
  assert.equal(state.configVersionsError, null);
  assert.equal(Object.prototype.hasOwnProperty.call(state, 'latestConfigVersion'), false);
});

test('config catalog failure is fail-closed without local fallback versions', async () => {
  const adapter = createBf11UiAdapter({
    getCapabilities: async () => ({}),
    getConfigVersions: async () => {
      const error = new Error('catalog unavailable');
      error.status = 503;
      throw error;
    },
    listBatches: async () => ({ batches: [] })
  });
  const load = await adapter.loadWorkbench();
  assert.deepEqual(load.configVersions, []);
  assert.equal(load.configVersionsError.status, 503);
  assert.match(load.configVersionsError.message, /catalog unavailable/);
});

test('server config selection never invents latest and sync patch uses only versionConfigId', () => {
  const catalog = [
    { id: 'cfg-a', name: 'A' },
    { id: 'cfg-b', name: 'B' }
  ];
  assert.deepEqual(adapterModule.configVersionOptions(catalog), [
    { value: 'cfg-a', label: 'A' },
    { value: 'cfg-b', label: 'B' }
  ]);
  assert.deepEqual(adapterModule.buildConfigVersionSyncPatch(catalog, 'cfg-b'), { versionConfigId: 'cfg-b' });
  assert.equal(adapterModule.buildConfigVersionSyncPatch(catalog, 'latest'), null);
});

test('batch-only config sync preserves sparse false empty string and zero and never calls child override endpoints', async () => {
  const calls = [];
  const adapter = createBf11UiAdapter({
    saveBatchSettings: async (batchId, input) => {
      calls.push(['batch', batchId, input]);
      return { patch: input.patch, revision: 10 };
    },
    saveBookOverride: async () => { throw new Error('book override must not be touched'); },
    saveVideoOverride: async () => { throw new Error('video override must not be touched'); }
  });
  await adapter.saveDrawer({
    scope: 'batch',
    batchId: 'b1',
    patch: { versionConfigId: 'cfg-current', enabled: false, empty: '', zero: 0, inherit: undefined },
    revision: 9
  });
  assert.deepEqual(calls, [[
    'batch',
    'b1',
    { patch: { versionConfigId: 'cfg-current', enabled: false, empty: '', zero: 0 }, expectedRevision: 9 }
  ]]);
});

test('production settings drawer uses only server catalog and exposes controlled batch sync action', () => {
  const source = read('BatchFactoryV11SettingsDrawers.jsx');
  assert.equal(source.includes('const CONFIG_VERSIONS'), false);
  assert.match(source, /configVersions/);
  assert.match(source, /configVersionsError/);
  assert.match(source, /onSyncConfigVersion/);
  assert.match(source, /buildConfigVersionSyncPatch/);
  assert.match(source, /versionConfigId/);
  assert.match(source, /同步批量后台配置/);
  assert.equal(source.includes('配置版本同步将在接入 /config-versions 后启用'), false);
  assert.equal(source.includes('latestConfigVersion'), false);
});

test('ui page passes runtime catalog and config sync saves only the batch versionConfigId patch', () => {
  const source = read('BatchFactoryV11UiPage.jsx');
  assert.match(source, /runtimeState\.configVersions/);
  assert.match(source, /runtimeState\.configVersionsError/);
  assert.match(source, /onSyncConfigVersion/);
  assert.match(source, /scope:\s*'batch'/);
  assert.match(source, /patch:\s*\{\s*versionConfigId\s*\}/);
  assert.equal(source.includes('latestConfigVersion'), false);
});

test('book scoped config version selector uses the same Go catalog and no hardcoded version ids', () => {
  const scoped = read('BatchFactoryV11ScopedSettings.jsx');
  assert.match(scoped, /configVersions/);
  assert.match(scoped, /configVersionsError/);
  assert.match(scoped, /versionConfigId/);
  for (const hardcoded of ['v3.5', 'v3.2', 'v3.1', 'v3.0']) {
    assert.equal(scoped.includes(hardcoded), false, `hardcoded config version remains: ${hardcoded}`);
  }
  const page = read('BatchFactoryV11UiPage.jsx');
  assert.match(page, /<BookSettingsModal[\s\S]*configVersions={runtimeState\.configVersions/);
  assert.match(page, /configVersionsError={runtimeState\.configVersionsError/);
});
