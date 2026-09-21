const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '..', 'frontend/src/user/pages/ApiConfigPage.jsx'), 'utf8');

test('API configuration page renders a refreshable quota status for every model', () => {
  assert.match(page, /getManagedModelQuotas/);
  assert.match(page, /刷新额度/);
  assert.match(page, /额度未知/);
  assert.match(page, /可用额度/);
});
