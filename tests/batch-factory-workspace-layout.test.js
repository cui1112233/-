const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadLayoutModule() {
  const modulePath = path.join(__dirname, '../frontend/src/user/pages/batch-factory/workspace-layout.js');
  return import(pathToFileURL(modulePath).href);
}

test('invalid persisted values fall back and new cards are merged from defaults', async () => {
  const { DEFAULT_WORKSPACE_LAYOUT, mergeWorkspaceDefaults } = await loadLayoutModule();
  const saved = {
    columns: 99,
    rowHeight: -1,
    items: {
      'book-list': { x: -5, y: 0, w: 0, h: 1, hidden: false },
      unknown: { x: 0, y: 0, w: 2, h: 2, hidden: false }
    }
  };
  const result = mergeWorkspaceDefaults(saved, DEFAULT_WORKSPACE_LAYOUT);
  assert.equal(result.columns, 12);
  assert.equal(result.rowHeight, 48);
  assert.equal(result.items['book-list'].x >= 0, true);
  assert.equal(result.items['book-list'].w >= result.items['book-list'].minW, true);
  assert.equal(result.items.preview.w >= result.items.preview.minW, true);
  assert.ok(result.items['batch-tools']);
  assert.equal(Object.hasOwn(result.items, 'unknown'), false);
});

test('hidden state survives normalization for known cards', async () => {
  const { DEFAULT_WORKSPACE_LAYOUT, mergeWorkspaceDefaults } = await loadLayoutModule();
  const saved = {
    items: {
      preview: { ...DEFAULT_WORKSPACE_LAYOUT.items.preview, hidden: true }
    }
  };
  const result = mergeWorkspaceDefaults(saved, DEFAULT_WORKSPACE_LAYOUT);
  assert.equal(result.items.preview.hidden, true);
});

test('move snaps to integer grid and clamps within columns without mutation', async () => {
  const { DEFAULT_WORKSPACE_LAYOUT, moveWorkspaceItem } = await loadLayoutModule();
  const before = structuredClone(DEFAULT_WORKSPACE_LAYOUT);
  const result = moveWorkspaceItem(before, 'preview', 11.8, -3.2);
  assert.notEqual(result, before);
  assert.deepEqual(before, DEFAULT_WORKSPACE_LAYOUT);
  assert.equal(Number.isInteger(result.items.preview.x), true);
  assert.equal(result.items.preview.y, 0);
  assert.equal(result.items.preview.x + result.items.preview.w <= result.columns, true);
});

test('resize respects min size, grid bounds, and does not mutate input', async () => {
  const { DEFAULT_WORKSPACE_LAYOUT, resizeWorkspaceItem } = await loadLayoutModule();
  const before = structuredClone(DEFAULT_WORKSPACE_LAYOUT);
  const result = resizeWorkspaceItem(before, 'book-workbench', 1.2, 2.2);
  assert.notEqual(result, before);
  assert.deepEqual(before, DEFAULT_WORKSPACE_LAYOUT);
  assert.equal(result.items['book-workbench'].w >= result.items['book-workbench'].minW, true);
  assert.equal(result.items['book-workbench'].h >= result.items['book-workbench'].minH, true);
  assert.equal(result.items['book-workbench'].x + result.items['book-workbench'].w <= result.columns, true);
});

test('hide helper only changes the requested known card', async () => {
  const { DEFAULT_WORKSPACE_LAYOUT, setWorkspaceItemHidden } = await loadLayoutModule();
  const result = setWorkspaceItemHidden(DEFAULT_WORKSPACE_LAYOUT, 'batch-tools', true);
  assert.equal(result.items['batch-tools'].hidden, true);
  assert.equal(result.items.preview.hidden, false);
  assert.equal(DEFAULT_WORKSPACE_LAYOUT.items['batch-tools'].hidden, false);
});
