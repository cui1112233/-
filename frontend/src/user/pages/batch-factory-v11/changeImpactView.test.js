import test from 'node:test';
import assert from 'node:assert/strict';
import { changeImpactView } from './changeImpactView.js';

test('changeImpactView uses explicit server counts without deriving compatibility entries', () => {
  const impact = changeImpactView({
    affectedBooks: 12,
    affectedVideos: 37,
    orphanedOverrides: 3,
    incompatibleOverrides: 2,
    compatibility: [
      { state: 'orphaned' },
      { state: 'orphaned' },
      { state: 'orphaned' },
      { state: 'orphaned' }
    ]
  });

  assert.equal(impact.affectedBooks, 12);
  assert.equal(impact.affectedVideos, 37);
  assert.equal(impact.orphanedOverrides, 3);
  assert.equal(impact.incompatibleOverrides, 2);
});

test('changeImpactView does not invent affected counts when server omits them', () => {
  const impact = changeImpactView({
    compatibility: [{ state: 'orphaned' }, { state: 'incompatible' }]
  });

  assert.equal(impact.affectedBooks, null);
  assert.equal(impact.affectedVideos, null);
  assert.equal(impact.orphanedOverrides, null);
  assert.equal(impact.incompatibleOverrides, null);
});

test('changeImpactView accepts explicit nested impact and preserves server warning text', () => {
  const impact = changeImpactView({
    impact: {
      affectedBooks: 4,
      affectedVideos: 9,
      orphanedOverrides: 1,
      incompatibleOverrides: 0,
      invalidatesDirector: true,
      warning: '保存后需要重新 Director'
    }
  });

  assert.equal(impact.affectedBooks, 4);
  assert.equal(impact.affectedVideos, 9);
  assert.equal(impact.invalidatesDirector, true);
  assert.equal(impact.warning, '保存后需要重新 Director');
});

test('changeImpactView keeps omitted invalidatesDirector unknown', () => {
  assert.equal(changeImpactView({ affectedBooks: 1 }).invalidatesDirector, null);
});

test('changeImpactView does not coerce non-numeric fields into zero counts', () => {
  const impact = changeImpactView({
    affectedBooks: null,
    affectedVideos: [],
    orphanedOverrides: false,
    incompatibleOverrides: ''
  });

  assert.equal(impact.affectedBooks, null);
  assert.equal(impact.affectedVideos, null);
  assert.equal(impact.orphanedOverrides, null);
  assert.equal(impact.incompatibleOverrides, null);
});
