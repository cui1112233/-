const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('npm syntax gate covers structured logger and executor protocol files', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const check = String(pkg.scripts?.check || '');

  assert.match(check, /node --check src\/structured-logger\.js/);
  assert.match(check, /node --check src\/electron\/protocol-handler\.js/);
  assert.match(check, /node --check src\/electron\/main\.js/);
});
