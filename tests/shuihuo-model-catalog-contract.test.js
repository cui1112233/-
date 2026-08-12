const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '..', 'frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'frontend/src/shared/api/shuihuoProduction.js'), 'utf8');

test('shuihuo model catalog only exposes controlled production adapters', () => {
  for (const adapter of ['text_completion', 'jimeng_image', 'vidu_image_to_video']) {
    assert.match(page, new RegExp(adapter));
  }
  assert.doesNotMatch(page, /value:\s*['"]generic_http['"]/);
});

test('shuihuo model catalog never renders private runtime configuration fields', () => {
  for (const field of ['endpoint', 'requestTemplate', 'responseMapping']) {
    assert.doesNotMatch(page, new RegExp(`name=["']${field}["']`));
  }
});

test('admin model API only serializes the controlled configuration fields', () => {
  assert.match(api, /function createAdminModel\(\{ name, kind, adapterKind, enabled, parameterSchema, credentialRef \}\)/);
  for (const field of ['endpoint', 'requestTemplate', 'responseMapping']) {
    assert.doesNotMatch(api, new RegExp(`createAdminModel[\\s\\S]*${field}`));
  }
});
