const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

function loadCustomModelIdForTest() {
  const source = read('frontend/src/shared/modelCatalog/customModelId.js')
    .replace(/\bexport\s+/g, '');
  return new Function(`${source}\nreturn { createCustomModelId };`)();
}

test('custom model IDs are stable and collision-safe before catalog submission', () => {
  const { createCustomModelId } = loadCustomModelIdForTest();

  assert.equal(createCustomModelId({ displayName: 'GPT 5.4', modelId: 'gpt-5.4' }), 'custom-gpt-5-4');
  assert.equal(
    createCustomModelId({ displayName: 'GPT 5.4', modelId: 'gpt-5.4' }, ['custom-gpt-5-4']),
    'custom-gpt-5-4-2'
  );
});

test('API configuration gives managers typed presets and custom model CRUD', () => {
  const source = read('frontend/src/user/pages/ApiConfigPage.jsx');

  assert.match(source, /平台预设模型/);
  assert.match(source, /YD2\.0 Mini（图生）/);
  assert.match(source, /MiniMax H3 多图生视频/);
  assert.match(source, /本地豆包执行器/);
  assert.match(source, /MODEL_KINDS/);
  assert.match(source, /添加自定义模型/);
  assert.match(source, /createManagedModel/);
  assert.match(source, /updateManagedModel/);
  assert.match(source, /deleteManagedModel/);
  assert.match(source, /capabilities/);
  assert.match(source, /supportsReferenceImages/);
  assert.match(source, /requiresImageInput/);
  assert.match(source, /maxVideoDuration/);
  assert.doesNotMatch(source, /mode="tags"/);
  assert.match(source, /createCustomModelId/);
  assert.match(source, /refreshLocalDoubaoPairingStatus/);
  assert.match(source, /isPresetReady/);
  assert.match(source, /disabled=\{!model\?\.enabled && !isPresetReady/);
});

test('API configuration keeps members out of credentials and manager CRUD controls', () => {
  const source = read('frontend/src/user/pages/ApiConfigPage.jsx');

  assert.match(source, /!canManageApi \?/);
  assert.match(source, /不会显示 API Key/);
  assert.match(source, /canManageModelCatalog/);
});
