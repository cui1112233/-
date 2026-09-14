import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../user/components/ShotOutputCards.jsx', import.meta.url), 'utf8');

test('invalid shot reference images are hidden instead of showing broken image placeholders', () => {
  assert.match(source, /failedReferenceKeys/);
  assert.match(source, /onError=\{\(\) => setFailedReferenceKeys/);
  assert.match(source, /visibleReferences\.length/);
});
