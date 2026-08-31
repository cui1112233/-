import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const targets = ['HookReviewPanel.jsx', 'DirectorPanel.jsx'];

test('director UI panels exist and stay controlled', () => {
  for (const name of targets) {
    const file = path.join(here, name);
    assert.equal(fs.existsSync(file), true, `missing ${name}`);
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /directorState/);
    assert.doesNotMatch(source, /batchFactoryV11|apiRequest|fetch\(/);
  }
});

test('HookReviewPanel uses the Go hook.review capability for both controlled actions', () => {
  const source = fs.readFileSync(path.join(here, 'HookReviewPanel.jsx'), 'utf8');
  assert.match(source, /\['hook\.review'\]/);
  assert.equal(source.includes("['hook.run']"), false);
  assert.equal(source.includes("['hook.approve']"), false);
});
