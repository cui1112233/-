const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('server attaches V78 novel-fetch V2 before delegating to the core app', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /attachV78NovelFetchV2/);
  assert.match(source, /const coreApp = createApp\(\);/);
  const attachAt = source.indexOf('attachV78NovelFetchV2({');
  const mountAt = source.indexOf('app.use(coreApp);');
  assert.ok(attachAt >= 0, 'missing V2 attach call');
  assert.ok(mountAt > attachAt, 'core app must mount after V2 API');
});
