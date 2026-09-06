const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UpdatePreferencesStore, normalizeChannel } = require('../src/update-preferences-store');

test('new executor installations default to the stable update channel', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yizhan-update-channel-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new UpdatePreferencesStore({ filePath: path.join(root, 'update-preferences.json') });

  assert.deepEqual(store.load(), { channel: 'stable' });
  assert.equal(normalizeChannel(undefined), 'stable');
  assert.equal(normalizeChannel(''), 'stable');
});

test('explicit beta choice remains supported', () => {
  assert.equal(normalizeChannel('beta'), 'beta');
  assert.equal(normalizeChannel('stable'), 'stable');
});
