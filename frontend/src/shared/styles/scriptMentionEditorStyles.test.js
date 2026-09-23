import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('inline mention editor keeps screenplay line breaks, height, scrolling and visible chips', () => {
  const source = fs.readFileSync(new URL('./global.css', import.meta.url), 'utf8');

  assert.match(source, /\.script-mention-editor\s*\{/);
  assert.match(source, /white-space:\s*pre-wrap/);
  assert.match(source, /min-height:\s*100%/);
  assert.match(source, /overflow:\s*auto/);
  assert.match(source, /\.script-mention-chip\s*\{/);
});
