import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('fixed single VIDEO control exists and uses server duration label', () => {
  const file = path.join(here, 'FixedSingleVideoControl.jsx');
  assert.equal(fs.existsSync(file), true);
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /fixedVideoLabel/);
  assert.doesNotMatch(source, /15\s*秒|10\s*秒/);
  assert.doesNotMatch(source, /batchFactoryV11|apiRequest|fetch\(/);
});
