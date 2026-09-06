import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedBookIds, selectionScopeLabel, toggleAllBooks, toggleBookSelection } from './selectionState.js';

test('selection state supports one book, all books, and filtered scope', () => {
  const books = [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }];
  assert.deepEqual(toggleBookSelection([], 'b2'), ['b2']);
  assert.deepEqual(toggleBookSelection(['b2'], 'b2'), []);
  assert.deepEqual(toggleAllBooks([], books), ['b1', 'b2', 'b3']);
  assert.deepEqual(toggleAllBooks(['b1', 'b2', 'b3'], books), []);
  assert.deepEqual(selectedBookIds(['b1', 'missing', 'b1'], books), ['b1']);
  assert.equal(selectionScopeLabel(['b1'], books), '已选 1 本');
});

