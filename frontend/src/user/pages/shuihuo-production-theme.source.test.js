import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const stylesheet = readFileSync(new URL('./shuihuo-production.css', import.meta.url), 'utf8');

test('batch factory viewport-fill surfaces continue to use theme variables', () => {
  const fillBlock = stylesheet.match(/\/\* 当前页面所在的滚动容器保持同一种工作台底色 \*\/[\s\S]*?\/\* 表格最后一行后不再额外产生底部间距 \*\//)?.[0] || '';

  assert.match(fillBlock, /legacy-content:has\(\.batch-factory-workbench\)[\s\S]*?background:\s*var\(--sh-bg\)/);
  assert.match(fillBlock, /\.shuihuo-production:has\(\.batch-factory-workbench\)[\s\S]*?background:\s*var\(--sh-bg\)/);
  assert.match(fillBlock, /\.batch-factory-workbench\s*\{[\s\S]*?background:\s*var\(--sh-bg\)/);
  assert.match(fillBlock, /\.batch-factory-workbench-table\s*\{[\s\S]*?background:\s*var\(--sh-bg\)/);
  assert.doesNotMatch(fillBlock, /#0d172b/i);
});
