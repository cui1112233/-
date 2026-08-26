const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('current mainline mounts batch factory without replacing account-center routes', () => {
  const app = read('app.js');
  const userApp = read('frontend/src/user/App.jsx');
  const layout = read('frontend/src/shared/layouts/UserLayout.jsx');
  assert.match(app, /createBatchFactoryRouter/);
  assert.match(app, /app\.use\('\/api\/batch-factory'/);
  assert.match(userApp, /'\/batch-factory': BatchFactoryPage/);
  assert.match(layout, /href: '\/batch-factory'/);
  assert.match(layout, /ACCOUNT_CENTER_ROUTES/);
});

test('public video model contract exposes batch-factory capability fields', () => {
  const catalog = read('backend/internal/shuihuo/models/catalog.go');
  assert.match(catalog, /RequiresImageInput\s+bool/);
  assert.match(catalog, /MaxVideoDuration\s+int/);
  assert.match(catalog, /func \(model Definition\) MaxVideoDuration\(\) int/);
});
