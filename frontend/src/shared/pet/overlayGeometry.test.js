import assert from 'node:assert/strict';
import test from 'node:test';
import { didDrag, getOverlayLayout } from './overlayGeometry.js';

test('requires eight pixels before a drag', () => {
  assert.equal(didDrag({ x: 0, y: 0 }, { x: 7, y: 0 }), false);
  assert.equal(didDrag({ x: 0, y: 0 }, { x: 8, y: 0 }), true);
});

test('keeps panel inside all desktop corners', () => {
  for (const pet of [
    { left: 0, top: 56 },
    { left: 1320, top: 56 },
    { left: 0, top: 770 },
    { left: 1320, top: 770 }
  ]) {
    const panel = getOverlayLayout({
      viewport: { width: 1440, height: 900, topInset: 56 },
      pet
    }).panel;

    assert.ok(panel.left >= 8 && panel.top >= 64);
    assert.ok(panel.left + panel.width <= 1432 && panel.top + panel.height <= 892);
  }
});

test('uses an above placement without overflowing a narrow viewport', () => {
  const viewport = { width: 300, height: 700, topInset: 56 };
  const panel = getOverlayLayout({ viewport, pet: { left: 80, top: 300 } }).panel;

  assert.equal(panel.placement, 'above');
  assert.ok(panel.left >= 8 && panel.top >= 64);
  assert.ok(panel.left + panel.width <= viewport.width - 8);
  assert.ok(panel.top + panel.height <= viewport.height - 8);
});

test('keeps tiny viewport panel dimensions and coordinates finite and bounded', () => {
  const viewport = { width: 12, height: 20, topInset: 56 };
  const panel = getOverlayLayout({
    viewport,
    pet: { left: Number.NaN, top: Number.POSITIVE_INFINITY }
  }).panel;

  assert.equal(panel.placement, 'above');
  assert.equal(panel.width, 0);
  assert.equal(panel.height, 0);
  assert.ok(Number.isFinite(panel.left) && Number.isFinite(panel.top));
  assert.ok(panel.left >= 0 && panel.left <= viewport.width);
  assert.ok(panel.top >= 0 && panel.top <= viewport.height);
});

test('returns safe finite geometry for missing, null, and throwing inputs', () => {
  for (const input of [undefined, null, {}, { viewport: null, pet: null }]) {
    const panel = getOverlayLayout(input).panel;
    assert.ok(Number.isFinite(panel.left) && Number.isFinite(panel.top));
    assert.ok(Number.isFinite(panel.width) && Number.isFinite(panel.height));
    assert.ok(panel.width >= 0 && panel.height >= 0);
  }

  const throwingPoint = {};
  Object.defineProperty(throwingPoint, 'x', { get() { throw new Error('no x'); } });
  assert.equal(didDrag(throwingPoint, null), false);

  const throwingInput = new Proxy({}, { get() { throw new Error('unavailable'); } });
  assert.doesNotThrow(() => getOverlayLayout(throwingInput));
});
