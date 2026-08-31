import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(here, name), 'utf8');

test('final UI page uses the V11 client runtime and no showcase business data', () => {
  const source = read('BatchFactoryV11UiPage.jsx');
  assert.match(source, /batchFactoryV11/);
  assert.match(source, /createBf11UiAdapter/);
  assert.match(source, /createBf11Runtime/);
  assert.match(source, /phase === 'loading'/);
  assert.match(source, /phase === 'error'/);
  assert.equal(source.includes('SHOWCASE_'), false);
});

test('workbench has no demo defaults and gates unreleased actions from capabilities', () => {
  const source = read('BatchFactoryV11Workbench.jsx');
  assert.equal(source.includes('SHOWCASE_BATCH'), false);
  assert.equal(source.includes('SHOWCASE_BOOKS'), false);
  assert.match(source, /capabilities/);
  assert.match(source, /actionState/);
  assert.match(source, /director\.run/);
  assert.match(source, /production\.run/);
  assert.match(source, /merge\.run/);
});

test('settings editors use save flow so failed saves stay open', () => {
  const production = read('BatchFactoryV11SettingsDrawers.jsx');
  const scoped = read('BatchFactoryV11ScopedSettings.jsx');
  assert.match(production, /runSaveFlow/);
  assert.match(scoped, /runSaveFlow/);
});
