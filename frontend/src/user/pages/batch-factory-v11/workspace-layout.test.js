import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WORKSPACE_LAYOUT,
  GRID_COLUMNS,
  REQUIRED_CARD_IDS,
  WORKSPACE_STORAGE_KEY,
  mergeWorkspaceDefaults,
  moveWorkspaceItem,
  resizeWorkspaceItem,
  resetWorkspaceLayout,
  setItemMaximized,
  setWorkspaceItemCollapsed,
  setWorkspaceItemHidden
} from './workspace-layout.js';

test('uses the approved V78 12-column workspace schema', () => {
  assert.equal(GRID_COLUMNS, 12);
  assert.equal(WORKSPACE_STORAGE_KEY, 'qiantie:batch-factory:layout:v1');
  assert.deepEqual(REQUIRED_CARD_IDS, ['book-list', 'book-workbench', 'preview', 'batch-tools']);
  assert.equal(DEFAULT_WORKSPACE_LAYOUT.items['book-list'].w, 3);
  assert.equal(DEFAULT_WORKSPACE_LAYOUT.items['book-workbench'].w, 5);
  assert.equal(DEFAULT_WORKSPACE_LAYOUT.items.preview.x, 8);
  assert.equal(DEFAULT_WORKSPACE_LAYOUT.items['batch-tools'].y, 6);
});

test('normalizes malformed persisted layouts without changing the 12-column schema', () => {
  const layout = mergeWorkspaceDefaults({
    columns: 99,
    rowHeight: -1,
    gap: 999,
    items: {
      'book-list': { x: -9, y: -2, w: 1, h: 1 },
      preview: { x: 50, y: 3, w: 50, h: 1 }
    }
  });
  assert.equal(layout.columns, 12);
  assert.equal(layout.items['book-list'].x, 0);
  assert.ok(layout.items['book-list'].w >= layout.items['book-list'].minW);
  assert.ok(layout.items.preview.x + layout.items.preview.w <= 12);
  assert.ok(layout.rowHeight > 0);
  assert.ok(layout.gap <= 64);
});

test('supports edit-layout move resize collapse hide and maximize state', () => {
  let layout = resetWorkspaceLayout();
  layout = moveWorkspaceItem(layout, 'book-workbench', 4, 2);
  assert.equal(layout.items['book-workbench'].x, 4);
  assert.equal(layout.items['book-workbench'].y, 2);

  layout = resizeWorkspaceItem(layout, 'preview', 3, 8);
  assert.equal(layout.items.preview.w, 3);
  assert.equal(layout.items.preview.h, 8);

  layout = setWorkspaceItemCollapsed(layout, 'preview', true);
  assert.equal(layout.items.preview.collapsed, true);

  layout = setItemMaximized(layout, 'preview', true);
  assert.equal(layout.maximizedId, 'preview');

  layout = setWorkspaceItemHidden(layout, 'preview', true);
  assert.equal(layout.items.preview.hidden, true);
  assert.equal(layout.maximizedId, null);
});

test('restore default returns independent default state', () => {
  const first = resetWorkspaceLayout();
  first.items['book-list'].x = 7;
  const second = resetWorkspaceLayout();
  assert.equal(second.items['book-list'].x, 0);
  assert.notEqual(first.items, second.items);
});
