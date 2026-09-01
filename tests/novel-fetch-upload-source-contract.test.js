const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'novel-fetch-upload.js'), 'utf8');

test('novel-fetch upload route is Browser Worker only and contains no legacy PHP cookie login path', () => {
  assert.match(source, /create121BrowserClient/);
  assert.match(source, /browserClient\.login/);
  assert.match(source, /browserClient\.test/);
  assert.match(source, /browserClient\.action/);
  assert.match(source, /getBrowserSession/);
  assert.match(source, /setBrowserSession/);
  assert.doesNotMatch(source, /buildLoginRequest/);
  assert.doesNotMatch(source, /\.getSession\(/);
  assert.doesNotMatch(source, /\.setSession\(/);
  assert.doesNotMatch(source, /Cookie\s*:/);
  assert.doesNotMatch(source, /PHPSESSID/);
});
