import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../user/components/ShotOutputCards.jsx', import.meta.url), 'utf8');

test('shot references use clickable name tags instead of broken image placeholders', () => {
  assert.match(source, /shotReferenceStates/);
  assert.match(source, /onToggleReference/);
  assert.match(source, /aria-pressed/);
  assert.doesNotMatch(source, /shot-output-card-reference-thumbnail/);
});
