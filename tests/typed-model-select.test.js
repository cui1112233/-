const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('typed model selector refreshes only its requested kind and keeps an explicit empty state', () => {
  const source = read('frontend/src/user/components/TypedModelSelect.jsx');

  assert.match(source, /listAvailableModels\(kind\)/);
  assert.match(source, /useEffect\(\(\) => \{ refresh\(\); \}, \[refresh\]\)/);
  assert.match(source, /onFocus=\{refresh\}/);
  assert.match(source, /onDropdownVisibleChange=\{open => open && refresh\(\)\}/);
  assert.match(source, /尚未添加可用的\$\{MODEL_KIND_LABELS\[kind\]\}模型/);
  assert.doesNotMatch(source, /defaultValue=/);
});

test('typed model selector exposes API-provided ids and display names only', () => {
  const source = read('frontend/src/user/components/TypedModelSelect.jsx');

  assert.match(source, /value: model\.id, label: model\.displayName/);
  assert.doesNotMatch(source, /value: model\.modelId/);
  assert.doesNotMatch(source, /label: model\.modelId/);
});

test('model catalog client separates available-model reads from manager CRUD', () => {
  const source = read('frontend/src/shared/api/modelCatalog.js');

  assert.match(source, /apiRequest\(`\/api\/models\?kind=\$\{encodeURIComponent\(kind\)\}`\)/);
  assert.match(source, /apiRequest\('\/api\/config\/models', \{ method: 'POST'/);
  assert.match(source, /method: 'PATCH'/);
  assert.match(source, /method: 'DELETE'/);
});
