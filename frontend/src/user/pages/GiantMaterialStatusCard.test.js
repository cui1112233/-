import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./GiantMaterialStatusCard.jsx', import.meta.url), 'utf8');

test('defines the shared giant material status phases and progress fields', () => {
  for (const phase of ['idle', 'resolving', 'reading', 'ocr', 'cleaning', 'success', 'error', 'cancelled']) {
    assert.match(source, new RegExp(`(?:['"]${phase}['"]|\\b${phase}\\s*:)`));
  }
  assert.match(source, /indeterminate/);
  assert.match(source, /aria-label/);
  assert.match(source, /compact/);
});
