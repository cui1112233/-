import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, 'BatchFactoryV11UiPage.jsx'), 'utf8');
const scoped = fs.readFileSync(path.join(here, 'BatchFactoryV11ScopedSettings.jsx'), 'utf8');

test('UiPage does not synthesize effective batch or VIDEO parent settings', () => {
  assert.equal(page.includes('batch.mode ?? patch.productionMode'), false);
  assert.equal(page.includes('...batchSettingsState.patch'), false);
  assert.equal(page.includes("...(activeVideoBook?.settingsState?.patch || {})"), false);
  assert.equal(page.includes('parentSettings='), false);
});

test('scoped settings edit only their own sparse patch instead of merged display values', () => {
  assert.equal(scoped.includes('{ ...batchSettings, ...patch }'), false);
  assert.equal(scoped.includes('{ ...parentSettings, ...patch }'), false);
  assert.equal(scoped.includes('parentSettings = {}'), false);
  assert.match(scoped, /value=\{patch\}/);
});

test('VIDEO duration UI does not invent a default duration or local Director invalidation result', () => {
  assert.equal(scoped.includes('video?.duration || 10'), false);
  assert.equal(scoped.includes('durationChanged'), false);
  assert.match(scoped, /编排结果是否失效以服务端变更影响为准/);
});
