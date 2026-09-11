const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'frontend/src/user/pages/ApiConfigPage.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'frontend/src/shared/styles/account-center-visual-rebuild.css'), 'utf8');

test('API catalog tables keep a shared fixed four-column geometry', () => {
  assert.match(page, /className="ac-model-catalog-table"/);
  assert.match(page, /tableLayout="fixed"/);
  assert.match(page, /scroll=\{\{ x: 720 \}\}/);
  for (const width of ["'42%'", "'18%'", "'14%'", "'26%'"]) {
    assert.ok(page.includes(`width: ${width}`), `missing shared catalog width ${width}`);
  }
});

test('platform presets use a stable information, credential, and state grid', () => {
  assert.match(page, /className="ac-platform-preset-grid"/);
  assert.match(page, /className="ac-platform-preset-info"/);
  assert.match(page, /className="ac-platform-preset-credential"/);
  assert.match(styles, /\.api-config-page \.ac-platform-preset-grid/);
  assert.match(styles, /grid-template-columns: minmax\(0, 42%\) minmax\(260px, 1fr\) 96px/);
});
