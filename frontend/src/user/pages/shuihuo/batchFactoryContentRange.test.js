import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFactoryWorkText, contentRangeLinesForBook } from './batchFactoryContentRange.js';

test('uses the saved per-book content range as the work-text boundary', () => {
  const book = { sourceMetadata: { contentRangeLines: 5 } };
  assert.equal(contentRangeLinesForBook(book), 5);
  assert.equal(batchFactoryWorkText('第一段\n\n第二段\n第三段\n第四段\n第五段\n第六段', book), '第一段\n第二段\n第三段\n第四段\n第五段');
});

test('keeps the full original separate from the limited work text', () => {
  const source = '一\n二\n三';
  assert.equal(batchFactoryWorkText(source, { sourceMetadata: { contentRangeLines: 2 } }), '一\n二');
  assert.equal(source, '一\n二\n三');
});
