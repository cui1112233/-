const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function functionBody(source, functionName) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`).exec(source);
  assert.ok(declaration?.index !== undefined, `missing function ${functionName}`);

  const start = declaration.index + declaration[0].length;
  let depth = 1;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && nextCharacter === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === '/' && nextCharacter === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && nextCharacter === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index);
  }

  assert.fail(`unterminated function ${functionName}`);
}

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

  for (const functionName of ['testTextConfig', 'testImageConfig']) {
    assert.match(functionBody(apiSource, functionName), /suppressGlobalError:\s*true/);
  }

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

  for (const functionName of ['handleTestText', 'handleTestImage']) {
    assert.doesNotMatch(functionBody(pageSource, functionName), /\bsaveConfig\s*\(/);
  }
  assert.match(functionBody(pageSource, 'handleSave'), /\bsaveConfig\s*\(/);

  const textTestBody = functionBody(pageSource, 'handleTestText');
  const imageTestBody = functionBody(pageSource, 'handleTestImage');
  assert.match(pageSource, /function connectionResponseMessage\(candidate, fallback\)/);
  assert.match(pageSource, /typeof candidate\?\.content === 'string'/);
  assert.match(textTestBody, /message\.success\(connectionResponseMessage\(result\.message, '连接成功'\)\)/);
  assert.doesNotMatch(textTestBody, /\$\{result\.message\}/);
  assert.match(imageTestBody, /if \(result\.modelListed === false\) \{\s*message\.warning\(imageMessage\);/);
  assert.match(imageTestBody, /\} else \{\s*message\.success\(imageMessage\);/);
});

test('connection-test save guard detects an unsafe function body', () => {
  const unsafeSource = 'async function handleTestText() { await saveConfig({}); }';

  assert.throws(() => {
    assert.doesNotMatch(functionBody(unsafeSource, 'handleTestText'), /\bsaveConfig\s*\(/);
  }, assert.AssertionError);
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
