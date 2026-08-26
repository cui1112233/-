const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const styles = fs.readFileSync(path.resolve(__dirname, '../frontend/src/shared/styles/global.css'), 'utf8');

test('admin main is a viewport-height vertical scroll container', () => {
  const rule = styles.match(/\.admin-main\s*\{([^}]*)\}/);

  assert.ok(rule, 'admin main rule must exist');
  assert.match(rule[1], /(?:^|;)\s*height:\s*100vh;/, 'admin main must have a definite viewport height');
  assert.match(rule[1], /overflow-y:\s*auto;/, 'admin main must scroll vertically when prompt tables exceed the viewport');
});
