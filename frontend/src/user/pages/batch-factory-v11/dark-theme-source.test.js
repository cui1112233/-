import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(here, name), 'utf8');

test('BF11 dark theme owns readable tokens and paints the page gutters', () => {
  const css = read('batch-factory-v11-theme.css');
  for (const token of ['#0b1220', '#f3f6fa', '#c7d0db', '#98a2b3', '#667085', '#2b3748', '#f87171']) {
    assert.match(css, new RegExp(token.replace('#', '\\#'), 'i'));
  }
  assert.match(css, /\[data-bf-v11-ui=['"]final['"]\]/);
  assert.match(css, /background:\s*var\(--bf11-bg\)/);
});

test('BF11 dark theme explicitly fixes AntD contrast-sensitive controls', () => {
  const css = read('batch-factory-v11-theme.css');
  for (const selector of ['ant-typography-secondary', 'ant-tag', 'ant-segmented', 'ant-input', 'ant-btn']) {
    assert.match(css, new RegExp(selector));
  }
  assert.match(css, /::placeholder/);
});
