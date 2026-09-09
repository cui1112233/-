const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeShotReferenceStates } = require('../routes/history');

test('history keeps bounded per-shot disabled reference image state', () => {
  const state = normalizeShotReferenceStates({
    0: { disabledImageUrls: [' https://example.test/a.png ', 'https://example.test/a.png', ''] },
    invalid: { disabledImageUrls: ['https://example.test/ignored.png'] },
    1: { disabledImageUrls: Array.from({ length: 12 }, (_, index) => `https://example.test/${index}.png`) }
  });
  assert.deepEqual(state[0], { disabledImageUrls: ['https://example.test/a.png'] });
  assert.equal(state.invalid, undefined);
  assert.equal(state[1].disabledImageUrls.length, 9);
});
