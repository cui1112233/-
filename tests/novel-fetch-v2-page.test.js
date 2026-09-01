const test = require('node:test');
const assert = require('node:assert/strict');

const { injectNovelFetchV2Script } = require('../lib/novel-fetch-workshop/v2-page');

test('injects V78 novel-fetch V2 clients exactly once after legacy app', () => {
  const source = '<html><body><script src="./app.js?v=old"></script></body></html>';
  const first = injectNovelFetchV2Script(source);
  const second = injectNovelFetchV2Script(first);
  assert.match(first, /app\.js\?v=old/);
  assert.match(first, /\/batch-rewrite\/v78-novel-fetch-v2\.js/);
  assert.match(first, /\/batch-rewrite\/v78-novel-fetch-v2-layout\.js/);
  assert.equal((second.match(/v78-novel-fetch-v2\.js/g) || []).length, 1);
  assert.equal((second.match(/v78-novel-fetch-v2-layout\.js/g) || []).length, 1);
});

test('fails closed when legacy HTML has no body end marker', () => {
  assert.equal(injectNovelFetchV2Script('<html>broken'), '<html>broken');
});