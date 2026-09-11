const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
function loadModelCatalogForTest(apiRequest) {
  const source = read('frontend/src/shared/api/modelCatalog.js')
    .replace("import { apiRequest } from './client';", '')
    .replace(/\bexport\s+/g, '');
  return new Function('apiRequest', `${source}\nreturn { listAvailableModels, refreshAvailableModels, getTypedModelSelectState };`)(apiRequest);
}

test('available-model reads reject an invalid kind before making a request', async () => {
  const { listAvailableModels } = loadModelCatalogForTest();
  let calls = 0;

  await assert.rejects(
    () => listAvailableModels('audio', async () => { calls += 1; return { models: [] }; }),
    /无效的模型类型/
  );
  assert.equal(calls, 0);
});

test('safe available-model refresh returns empty options and a readable error on request failure', async () => {
  const { refreshAvailableModels } = loadModelCatalogForTest();
  const result = await refreshAvailableModels('video', async () => {
    throw new Error('网络不可用');
  });

  assert.deepEqual(result.models, []);
  assert.equal(result.error, '加载视频模型失败：网络不可用');
});

test('selector state renders a safe invalid-kind state without exposing undefined labels', () => {
  const { getTypedModelSelectState } = loadModelCatalogForTest();
  const state = getTypedModelSelectState('audio', { models: [{ id: 'wrong' }] });

  assert.deepEqual(state, { validKind: false, models: [], placeholder: '模型类型无效' });
});

test('typed model selector exposes API-provided ids and display names only', () => {
  const source = read('frontend/src/user/components/TypedModelSelect.jsx');

  assert.match(source, /value: model\.id, label: model\.displayName/);
  assert.doesNotMatch(source, /value: model\.modelId/);
  assert.doesNotMatch(source, /label: model\.modelId/);
});

test('model catalog client separates available-model reads from manager CRUD', () => {
  const source = read('frontend/src/shared/api/modelCatalog.js');

  assert.match(source, /request\(`\/api\/models\?kind=\$\{encodeURIComponent\(validKind\)\}`\)/);
  assert.match(source, /apiRequest\('\/api\/config\/models', \{ method: 'POST'/);
  assert.match(source, /method: 'PATCH'/);
  assert.match(source, /method: 'DELETE'/);
});
