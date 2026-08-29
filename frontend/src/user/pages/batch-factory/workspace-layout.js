export const GRID_COLUMNS = 12;

export const REQUIRED_CARD_IDS = Object.freeze([
  'book-list',
  'book-workbench',
  'preview',
  'batch-tools'
]);

const MIN_SIZE = Object.freeze({
  'book-list': Object.freeze({ w: 2, h: 4 }),
  'book-workbench': Object.freeze({ w: 4, h: 5 }),
  preview: Object.freeze({ w: 3, h: 3 }),
  'batch-tools': Object.freeze({ w: 3, h: 2 })
});

const DEFAULT_ITEMS = Object.freeze({
  'book-list': Object.freeze({ x: 0, y: 0, w: 3, h: 8, hidden: false }),
  'book-workbench': Object.freeze({ x: 3, y: 0, w: 5, h: 8, hidden: false }),
  preview: Object.freeze({ x: 8, y: 0, w: 4, h: 5, hidden: false }),
  'batch-tools': Object.freeze({ x: 8, y: 5, w: 4, h: 3, hidden: false })
});

export const DEFAULT_LAYOUT = Object.freeze({
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

function cloneItem(item) {
  return {
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    hidden: item.hidden === true
  };
}

function normalizeItem(id, candidate) {
  const fallback = DEFAULT_ITEMS[id];
  const minimum = MIN_SIZE[id];
  const source = candidate && typeof candidate === 'object' ? candidate : {};

  const w = clamp(rounded(source.w, fallback.w), minimum.w, GRID_COLUMNS);
  const h = Math.max(minimum.h, rounded(source.h, fallback.h));
  const x = clamp(rounded(source.x, fallback.x), 0, GRID_COLUMNS - w);
  const y = Math.max(0, rounded(source.y, fallback.y));

  return {
    x,
    y,
    w,
    h,
    hidden: typeof source.hidden === 'boolean' ? source.hidden : fallback.hidden
  };
}

export function normalizeLayout(input) {
  const source = input && typeof input === 'object' ? input : {};
  const sourceItems = source.items && typeof source.items === 'object' ? source.items : {};
  const items = {};

  for (const id of REQUIRED_CARD_IDS) {
    items[id] = normalizeItem(id, sourceItems[id]);
  }

  return {
    items,
    maximizedId: REQUIRED_CARD_IDS.includes(source.maximizedId) ? source.maximizedId : null
  };
}

export function cloneLayout(layout = DEFAULT_LAYOUT) {
  const normalized = normalizeLayout(layout);
  return {
    items: Object.fromEntries(REQUIRED_CARD_IDS.map(id => [id, cloneItem(normalized.items[id])])),
    maximizedId: normalized.maximizedId
  };
}

export function resetLayout() {
  return cloneLayout(DEFAULT_LAYOUT);
}

export function moveItem(layout, id, position = {}) {
  const next = cloneLayout(layout);
  if (!REQUIRED_CARD_IDS.includes(id)) return next;

  const item = next.items[id];
  item.x = clamp(rounded(position.x, item.x), 0, GRID_COLUMNS - item.w);
  item.y = Math.max(0, rounded(position.y, item.y));
  return next;
}

export function resizeItem(layout, id, size = {}) {
  const next = cloneLayout(layout);
  if (!REQUIRED_CARD_IDS.includes(id)) return next;

  const item = next.items[id];
  const minimum = MIN_SIZE[id];
  const maxWidth = Math.max(minimum.w, GRID_COLUMNS - item.x);
  item.w = clamp(rounded(size.w, item.w), minimum.w, maxWidth);
  item.h = Math.max(minimum.h, rounded(size.h, item.h));
  return next;
}

export function setItemHidden(layout, id, hidden) {
  const next = cloneLayout(layout);
  if (!REQUIRED_CARD_IDS.includes(id)) return next;
  next.items[id].hidden = hidden === true;
  if (next.items[id].hidden && next.maximizedId === id) next.maximizedId = null;
  return next;
}

export function setItemMaximized(layout, id, maximized) {
  const next = cloneLayout(layout);
  if (!REQUIRED_CARD_IDS.includes(id)) return next;
  if (maximized === true) next.maximizedId = id;
  else if (next.maximizedId === id) next.maximizedId = null;
  return next;
}
