import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFetchedManualSources, manualBookIDsFromInput } from './batchFactoryManualFetch.js';

test('collects each numeric Book ID once from a manual novel list', () => {
  assert.deepEqual(manualBookIDsFromInput('100000000001\t书A\n100000000002  书B\n100000000001\t重复'), ['100000000001', '100000000002']);
});

test('creation is only ready when every listed book has fetched original text', () => {
  const ids = ['100000000001', '100000000002'];
  assert.equal(hasFetchedManualSources(ids, { '100000000001': '原文' }), false);
  assert.equal(hasFetchedManualSources(ids, { '100000000001': '原文', '100000000002': '另一段原文' }), true);
});
