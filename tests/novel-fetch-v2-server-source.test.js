const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('server attaches V78 novel-fetch V2 and fail-closed legacy gate before delegating to the core app', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /attachV78NovelFetchV2/);
  assert.match(source, /legacyV2MutationGate/);
  assert.match(source, /const coreApp = createApp\(\);/);
  const attachAt = source.indexOf('attachV78NovelFetchV2({');
  const gateAt = source.indexOf("app.use('/api/batch-rewrite', legacyV2MutationGate());");
  const mountAt = source.indexOf('app.use(coreApp);');
  assert.ok(attachAt >= 0, 'missing V2 attach call');
  assert.ok(gateAt > attachAt, 'legacy gate must run after V2 routes');
  assert.ok(mountAt > gateAt, 'core app must mount after V2 gate');
});
