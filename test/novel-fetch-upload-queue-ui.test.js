const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('public workbench gives pending uploads a readable status', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'batch-rewrite', 'v78-novel-fetch-v2-layout.js'), 'utf8');
  assert.match(source, /pending_upload:\s*'待上传'/);
});
