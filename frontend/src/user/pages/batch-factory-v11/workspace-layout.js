export const GRID_COLUMNS = 12;
export const DEFAULT_ROW_HEIGHT = 48;
export const DEFAULT_GAP = 12;
export const WORKSPACE_STORAGE_KEY = 'qiantie:batch-factory:layout:v1';

export const REQUIRED_CARD_IDS = Object.freeze([
  'book-list',
  'book-workbench',
  'preview',
  'batch-tools'
]);

const MIN_SIZE = Object.freeze({
  'book-list': Object.freeze({ w: 2, h: 5 }),
  'book-workbench': Object.freeze({ w: 4, h: 6 }),
  preview: Object.freeze({ w: 3, h: 4 }),
  'batch-tools': Object.freeze({ w: 3, h: 3 })
});

const DEFAULT_ITEMS = Object.freeze({
  'book-list': Object.freeze({ x: 0, y: 0, w: 3, h: 10, minW: 2, minH: 5, hidden: false, collapsed: false }),
  'book-workbench': Object.freeze({ x: 3, y: 0, w: 5, h: 10, minW: 4, minH: 6, hidden: false, collapsed: false }),
  preview: Object.freeze({ x: 8, y: 0, w: 4, h: 6, minW: 3, minH: 4, hidden: false, collapsed: false }),
  'batch-tools': Object.freeze({ x: 8, y: 6, w: 4, h: 4, minW: 3, minH: 3, hidden: false, collapsed: false })
});

export const DEFAULT_WORKSPACE_LAYOUT = Object.freeze({
  columns: GRID_COLUMNS,
  rowHeight: DEFAULT_ROW_HEIGHT,
  gap: DEFAULT_GAP,
  items: DEFAULT_ITEMS,
  maximizedId: null
});

function rounded(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeItem(id, candidate, defaults = DEFAULT_ITEMS) {
  const fallback = defaults[id] || DEFAULT_ITEMS[id];
  const minimum = MIN_SIZE[id];
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  const minW = clamp(rounded(fallback.minW, minimum.w), 1, GRID_COLUMNS);
  const minH = Math.max(1, rounded(fallback.minH, minimum.h));
  const w = clamp(rounded(source.w, fallback.w), minW, GRID_COLUMNS);
  const h = Math.max(minH, rounded(source.h, fallback.h));
  const x = clamp(rounded(source.x, fallback.x), 0, GRID_COLUMNS - w);
  const y = Math.max(0, rounded(source.y, fallback.y));
  return {
    x,
    y,
    w,
    h,
    minW,
    minH,
    hidden: typeof source.hidden === 'boolean' ? source.hidden : fallback.hidden === true,
    collapsed: typeof source.collapsed === 'boolean' ? source.collapsed : fallback.collapsed === true
  };
}

export function mergeWorkspaceDefaults(input, defaults = DEFAULT_WORKSPACE_LAYOUT) {
  const source = input && typeof input === 'object' ? input : {};
  const sourceItems = source.items && typeof source.items === 'object' ? source.items : {};
  const defaultItems = defaults?.items || DEFAULT_ITEMS;
  const items = {};
  for (const id of REQUIRED_CARD_IDS) items[id] = normalizeItem(id, sourceItems[id], defaultItems);
  const rowHeightCandidate = rounded(source.rowHeight, defaults?.rowHeight || DEFAULT_ROW_HEIGHT);
  const gapCandidate = rounded(source.gap, defaults?.gap ?? DEFAULT_GAP);
  return {
    columns: GRID_COLUMNS,
    rowHeight: rowHeightCandidate > 0 && rowHeightCandidate <= 200 ? rowHeightCandidate : (defaults?.rowHeight || DEFAULT_ROW_HEIGHT),
    gap: gapCandidate >= 0 && gapCandidate <= 64 ? gapCandidate : (defaults?.gap ?? DEFAULT_GAP),
    items,
    maximizedId: REQUIRED_CARD_IDS.includes(source.maximizedId) ? source.maximizedId : null
  };
}

export function normalizeLayout(input) {
  return mergeWorkspaceDefaults(input);
}

export function cloneLayout(layout = DEFAULT_WORKSPACE_LAYOUT) {
  return mergeWorkspaceDefaults(layout);
}

export function resetWorkspaceLayout() {
  return mergeWorkspaceDefaults(DEFAULT_WORKSPACE_LAYOUT);
}

export function moveWorkspaceItem(layout, id, nextX, nextY) {
  const next = mergeWorkspaceDefaults(layout);
  if (!REQUIRED_CARD_IDS.includes(id)) return next;
  const item = next.items[id];
  item.x = clamp(rounded(nextX, item.x), 0, GRID_COLUMNS - item.w);
  item.y = Math.max(0, rounded(nextY, item.y));
  return next;
}

export function resizeWorkspaceItem(layout, id, nextWidth, nextHeight) {
  const next = mergeWorkspaceDefaults(layout);
  if (!REQUIRED_CARD_IDS.includes(id)) return next;
  const item = next.items[id];
  const maxWidth = Math.max(item.minW, GRID_COLUMNS - item.x);
  item.w = clamp(rounded(nextWidth, item.w), item.minW, maxWidth);
  item.h = Math.max(item.minH, rounded(nextHeight, item.h));
  return next;
}

export function setWorkspaceItemHidden(layout, id, hidden) {
  const next = mergeWorkspaceDefaults(layout);
  if (!REQUIRED_CARD_IDS.includes(id)) return next;
  next.items[id].hidden = hidden === true;
  if (next.items[id].hidden && next.maximizedId === id) next.maximizedId = null;
  return next;
}

export function setWorkspaceItemCollapsed(layout, id, collapsed) {
  const next = mergeWorkspaceDefaults(layout);
  if (!REQUIRED_CARD_IDS.includes(id)) return next;
  next.items[id].collapsed = collapsed === true;
  return next;
}

export function setItemMaximized(layout, id, maximized) {
  const next = mergeWorkspaceDefaults(layout);
  if (!REQUIRED_CARD_IDS.includes(id)) return next;
  next.maximizedId = maximized === true ? id : (next.maximizedId === id ? null : next.maximizedId);
  return next;
}
