import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'SettingsPage.jsx'), 'utf8');

test('settings exposes a separate giant material executor download and status card', () => {
  assert.match(source, /巨量素材执行器/);
  assert.match(source, /giant-material-executors/);
  assert.match(source, /GiantMaterialExecutor-windows-x64\.zip/);
  assert.match(source, /首次绑定一次/);
  assert.match(source, /生成配对码/);
  assert.match(source, /giantPairing/);
});
