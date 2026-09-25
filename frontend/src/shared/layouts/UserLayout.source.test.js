import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'UserLayout.jsx'), 'utf8');

test('global header status expires instead of permanently retaining API polling failures', () => {
  assert.match(source, /expiresAt/);
  assert.match(source, /window\.setTimeout\(\(\) =>/);
  assert.match(source, /setGlobalStatus\(current => current\.expiresAt === expiresAt \? \{ text: '', tone: 'idle'/);
});
