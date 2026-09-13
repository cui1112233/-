import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./vite.config.js', import.meta.url), 'utf8');

test('development server routes /admin/* to admin.html before the SPA fallback', () => {
  assert.match(source, /name:\s*['"]admin-route-entry['"]/);
  assert.match(source, /configureServer/);
  assert.match(source, /pathname === ['"]\/admin['"] \|\| pathname\.startsWith\(['"]\/admin\/['"]\)/);
  assert.match(source, /req\.url\s*=\s*`\/admin\.html/);
});
