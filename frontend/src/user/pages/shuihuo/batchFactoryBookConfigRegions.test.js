import assert from 'node:assert/strict';
import test from 'node:test';
import { BOOK_CONFIG_REGIONS, bookAssetSummary, bookConfigRegionStatus } from './batchFactoryBookConfigRegions.js';

test('exposes the five confirmed book configuration regions', () => {
  assert.deepEqual(BOOK_CONFIG_REGIONS.map(item => item.key), ['engine', 'assets', 'constraints', 'video', 'visual']);
});

test('reports book-level engine, video and AI module overrides separately', () => {
  const book = { settingsState: { patch: { videoModelId: 'video-a', fixedSingleVideo: true, aiPromptConfig: { constraints: { enabled: false } } } } };
  assert.equal(bookConfigRegionStatus(book, 'engine').tone, 'overridden');
  assert.equal(bookConfigRegionStatus(book, 'video').tone, 'overridden');
  assert.equal(bookConfigRegionStatus(book, 'constraints').tone, 'disabled');
  assert.equal(bookConfigRegionStatus(book, 'assets').tone, 'inherited');
});

test('summarizes real current-book assets instead of inventing an asset state', () => {
  assert.equal(bookAssetSummary({ assets: { characters: [{}], scenes: [{}, {}], props: [] } }), '人物 1 · 场景 2 · 道具 0');
});
