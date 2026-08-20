const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '..', 'frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'frontend/src/shared/api/shuihuoProduction.js'), 'utf8');

test('shuihuo model catalog exposes the controlled production adapters and an owner-only audio adapter', () => {
  for (const adapter of ['text_completion', 'jimeng_image', 'vidu_image_to_video']) {
    assert.match(page, new RegExp(adapter));
  }
  assert.match(page, /value:\s*['"]generic_http['"]/);
  assert.match(page, /kind:\s*['"]audio['"]/);
});

test('audio adapter reveals provider configuration only in the owner creation form', () => {
  for (const field of ['endpoint', 'requestTemplate', 'responseMapping']) {
    assert.match(page, new RegExp(`name=["']${field}["']`));
  }
  assert.match(page, /isGenericAdapter/);
  assert.match(page, /不会在模型列表或用户工作台返回/);
});

test('admin model API serializes the stable model ID and owner-only provider configuration for creation', () => {
  assert.match(api, /function createAdminModel\(\{ modelId, name, kind, adapterKind, enabled, parameterSchema, credentialRef, endpoint, requestTemplate, responseMapping \}\)/);
  assert.match(api, /JSON\.stringify\(\{ modelId, name, kind, adapterKind, enabled, parameterSchema, credentialRef, endpoint, requestTemplate, responseMapping \}\)/);
  for (const field of ['endpoint', 'requestTemplate', 'responseMapping']) {
    assert.match(api, new RegExp(`createAdminModel[\\s\\S]*${field}`));
  }
});
