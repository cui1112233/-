const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('settings expose independent OpenAI-compatible image fields without loading the key', () => {
  const source = read('frontend/src/user/pages/SettingsPage.jsx');

  for (const field of ['mode', 'provider', 'displayName', 'baseUrl', 'apiKey', 'model']) {
    assert.ok(source.includes("name={['image', '" + field + "']}"), "missing image field " + field);
  }
  assert.match(source, /OpenAI 兼容/);
  assert.match(source, /自定义（OpenAI 兼容）/);
  assert.match(source, /供应商名称/);
  assert.match(source, /image:\s*\{[\s\S]*?apiKey:\s*''/);
  assert.doesNotMatch(source, /image:\s*\{[\s\S]*?apiKey:\s*config\.image/);
});

test('settings test text and image connections independently without saving configuration', () => {
  const apiSource = read('frontend/src/shared/api/config.js');
  const pageSource = read('frontend/src/user/pages/SettingsPage.jsx');

  assert.match(apiSource, /export function testTextConfig\(config\)/);
  assert.match(apiSource, /apiRequest\('\/api\/test\/text'/);
  assert.match(apiSource, /export function testImageConfig\(image\)/);
  assert.match(apiSource, /apiRequest\('\/api\/test\/image'/);
  assert.match(apiSource, /body:\s*JSON\.stringify\(\{ image \}\)/);
  assert.doesNotMatch(apiSource, /export function testConfig\(/);

  assert.match(pageSource, /const \[testingText, setTestingText\] = useState\(false\);/);
  assert.match(pageSource, /const \[testingImage, setTestingImage\] = useState\(false\);/);
  assert.match(pageSource, /async function handleTestText\(\)/);
  assert.match(pageSource, /async function handleTestImage\(\)/);
  assert.match(pageSource, /form\.validateFields\(\['provider', 'baseUrl', 'model'\]\)/);
  assert.match(pageSource, /testTextConfig\(\{ \.\.\.values, apiKey: form\.getFieldValue\('apiKey'\) \}\)/);
  assert.match(pageSource, /form\.validateFields\(\[\['image', 'baseUrl'\], \['image', 'model'\]\]\)/);
  assert.match(pageSource, /testImageConfig\(\{ \.\.\.image, apiKey: form\.getFieldValue\(\['image', 'apiKey'\]\) \}\)/);
  assert.match(pageSource, />测试文本连接<\/Button>/);
  assert.match(pageSource, />测试生图连接<\/Button>/);
  assert.doesNotMatch(pageSource, /handleTest\(\)/);
  assert.doesNotMatch(pageSource, />测试连接<\/Button>/);
});

test('Shuihuo image model selectors preserve the account model ID zero', () => {
  for (const file of [
    'frontend/src/user/pages/shuihuo/BatchTaskModal.jsx',
    'frontend/src/user/pages/shuihuo/AssetsView.jsx'
  ]) {
    const source = read(file);
    assert.match(source, /typeof model\?\.id === 'number'/);
  }
  const drawer = read('frontend/src/user/pages/shuihuo/TaskDrawer.jsx');
  assert.doesNotMatch(drawer, /!segmentId \|\| !modelId/);
});
