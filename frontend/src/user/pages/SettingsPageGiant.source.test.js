import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'SettingsPage.jsx'), 'utf8');

test('settings offers platform preference and per-executor delete', () => {
  assert.match(source, /优先读取平台/);
  assert.match(source, /saveGiantExecutorPreference/);
  assert.match(source, /deleteGiantMaterialExecutor/);
  assert.match(source, /Segmented/);
});
