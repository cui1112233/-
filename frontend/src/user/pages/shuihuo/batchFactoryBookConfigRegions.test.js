import assert from 'node:assert/strict';
import test from 'node:test';
import { BOOK_CONFIG_REGIONS, bookAssetSummary, bookConfigRegionStatus } from './batchFactoryBookConfigRegions.js';

test('keeps single-book publishing inside engine configuration instead of a special region', () => {
  assert.deepEqual(BOOK_CONFIG_REGIONS.map(item => item.key), ['engine', 'assets', 'constraints', 'video', 'visual']);
});

test('reports fixed opening as an engine override and video prompts as a video override', () => {
  const book = { settingsState: { patch: { videoModelId: 'video-a', fixedSingleVideo: true, aiPromptConfig: { constraints: { enabled: false }, video: { presetId: 'batch-video-meta' } } } } };
  assert.equal(bookConfigRegionStatus(book, 'engine').tone, 'overridden');
  assert.equal(bookConfigRegionStatus(book, 'video').tone, 'overridden');
  assert.equal(bookConfigRegionStatus(book, 'constraints').tone, 'disabled');
  assert.equal(bookConfigRegionStatus(book, 'assets').tone, 'inherited');
});

test('does not mark video settings overridden when only fixed opening is overridden', () => {
  const book = { settingsState: { patch: { fixedSingleVideo: true } } };
  assert.equal(bookConfigRegionStatus(book, 'engine').tone, 'overridden');
  assert.equal(bookConfigRegionStatus(book, 'video').tone, 'inherited');
});

test('summarizes real current-book assets instead of inventing an asset state', () => {
  assert.equal(bookAssetSummary({ assets: { characters: [{}], scenes: [{}, {}], props: [] } }), '人物 1 · 场景 2 · 道具 0');
});

test('reports a nested publish mapping as an engine override', () => {
  assert.deepEqual(
    bookConfigRegionStatus({ settingsState: { patch: { publishSettings: { materialReuse: true } } } }, 'engine'),
    { label: '已单书覆盖', tone: 'overridden' }
  );
});
