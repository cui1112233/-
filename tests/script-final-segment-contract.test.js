const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('frontend/src/user/pages/scriptFinalSegment.js', 'utf8');

test('final segment delegates analyzed style to the Smart Unified selection', () => {
  assert.match(source, /shouldInjectSmartUnifiedStyle/);
  assert.doesNotMatch(source, /constraints\?\.prefix\?\.enabled === true \? text\(visualStyle\)/);
  assert.doesNotMatch(source, /统一风格：/);
});
