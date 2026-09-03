import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(here, name), 'utf8');

test('compatibility detail UI shows server entries without local count summary', () => {
  const source = read('OverrideCompatibilityDetails.jsx');
  assert.match(source, /orphaned/);
  assert.match(source, /incompatible/);
  assert.match(source, /videoId/);
  assert.match(source, /reason/);
  assert.equal(source.includes('compatibilitySummary'), false);
  assert.equal(source.includes('affectedBooks'), false);
  assert.equal(source.includes('affectedVideos'), false);
  assert.doesNotMatch(source, /batchFactoryV11|apiRequest|fetch\(/);
});

test('DirectorPanel delegates compatibility rendering instead of counting entries', () => {
  const source = read('DirectorPanel.jsx');
  assert.match(source, /OverrideCompatibilityDetails/);
  assert.equal(source.includes('compatibilitySummary'), false);
  assert.equal(source.includes('.filter(entry => entry?.state'), false);
});
