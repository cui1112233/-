import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, '../../..');
const required = [
  path.join(here, 'batchFactoryV11State.js'),
  path.join(here, 'bf11UiAdapter.js'),
  path.join(here, 'bf11Runtime.js'),
  path.resolve(frontendRoot, 'shared/api/batchFactoryV11.js')
];
const forbiddenPatterns = [
  /shared\/api\/batchFactory(?:\.js)?['"`]/,
  /shared\/api\/generation(?:\.js)?['"`]/,
  /shared\/api\/shuihuoProduction(?:\.js)?['"`]/,
  /\/api\/shuihuo-production\//
];

function collectFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return collectFiles(target);
    if (entry.name.endsWith('.test.js')) return [];
    return /\.(?:js|jsx)$/.test(entry.name) ? [target] : [];
  });
}

test('required V11 frontend adapter files exist', () => {
  for (const file of required) assert.equal(fs.existsSync(file), true, `missing ${file}`);
});

test('V11 frontend production files do not import legacy Batch Factory or production APIs', () => {
  const files = [
    ...collectFiles(here),
    path.resolve(frontendRoot, 'shared/api/batchFactoryV11.js')
  ].filter(fs.existsSync);
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of forbiddenPatterns) {
      assert.equal(pattern.test(source), false, `${path.relative(frontendRoot, file)} contains forbidden legacy API ${pattern}`);
    }
    const legacyRoute = /\/api\/batch-factory\/(?!v11(?:\/|['"`]))/;
    assert.equal(legacyRoute.test(source), false, `${path.relative(frontendRoot, file)} contains legacy Batch Factory route`);
  }
});
