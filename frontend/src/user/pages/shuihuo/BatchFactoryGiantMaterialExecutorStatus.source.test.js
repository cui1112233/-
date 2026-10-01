import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'BatchFactoryGiantMaterialExecutorStatus.jsx'), 'utf8');

test('dot status renders windows and macos separately', () => {
  assert.match(source, /gme-platform-pill/);
  assert.match(source, /Windows/);
  assert.match(source, /macOS/);
  assert.match(source, /getGiantExecutorPreference/);
});
