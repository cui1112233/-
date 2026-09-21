const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAutomationPresetStore } = require('./automation-presets');

test('automation presets are account-scoped, versioned snapshots', async () => {
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bf-preset-test-')), 'presets.json');
  const store = createAutomationPresetStore({ statePath });
  const created = await store.create('alice', { name: '夜间 H3', config: { textModelId: 'text-a', aiPromptConfig: { constraints: { baseSetup: { enabled: false } } } } });
  assert.equal(created.version, 1);
  assert.deepEqual((await store.list('alice')).map(item => item.name), ['夜间 H3']);
  assert.deepEqual(await store.list('bob'), []);

  const updated = await store.update('alice', created.id, { name: '夜间 H3 v2', config: { textModelId: 'text-b' }, expectedVersion: 1 });
  assert.equal(updated.version, 2);
  assert.equal(created.config.textModelId, 'text-a');
  assert.equal((await store.get('alice', created.id)).config.textModelId, 'text-b');
});
