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

test('model configuration lives in account center API configuration, not workspace settings', () => {
  const source = read('frontend/src/user/pages/SettingsPage.jsx');
  const apiConfig = read('frontend/src/user/pages/ApiConfigPage.jsx');
  assert.doesNotMatch(source, /settings-model-services/);
  assert.doesNotMatch(source, /测试文本连接|测试生图连接|保存视频生成/);
  assert.match(source, /豆包本地执行器/);
  assert.match(source, /local-executors/);
  assert.match(apiConfig, /文本模型连接/);
  assert.match(apiConfig, /生图服务/);
  assert.match(apiConfig, /视频生成服务/);
  assert.doesNotMatch(apiConfig, /豆包本地执行器|local-executors/);
});

test('account API configuration keeps independent text and image connection tests', () => {
  const apiSource = read('frontend/src/shared/api/config.js');
  const pageSource = read('frontend/src/user/pages/ApiConfigPage.jsx');

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
  assert.match(pageSource, /async function testText\(\)/);
  assert.match(pageSource, /async function testImage\(\)/);
  assert.match(pageSource, /form\.validateFields\(\['provider', 'baseUrl', 'model'\]\)/);
  assert.match(pageSource, /testTextConfig\(\{ \.\.\.values, apiKey: form\.getFieldValue\('apiKey'\) \}\)/);
  assert.match(pageSource, /testImageConfig\(\{ \.\.\.image, apiKey: form\.getFieldValue\(\['image', 'apiKey'\]\) \}\)/);
  assert.match(pageSource, />测试文本连接<\/Button>/);
  assert.match(pageSource, />测试生图连接<\/Button>/);
  assert.doesNotMatch(pageSource, />测试连接<\/Button>/);

  for (const functionName of ['testText', 'testImage']) {
    assert.doesNotMatch(functionBody(pageSource, functionName), /\bsaveConfig\s*\(/);
  }
  assert.match(functionBody(pageSource, 'save'), /\bsaveConfig\s*\(/);
  assert.match(pageSource, />保存 API 配置<\/Button>/);
  assert.match(pageSource, />保存视频生成<\/Button>/);

  const textTestBody = functionBody(pageSource, 'testText');
  const imageTestBody = functionBody(pageSource, 'testImage');
  assert.match(pageSource, /function connectionMessage\(candidate, fallback\)/);
  assert.match(pageSource, /typeof candidate\?\.content === 'string'/);
  assert.match(textTestBody, /message\.success\(connectionMessage\(result\.message, '文本模型连接成功'\)\)/);
  assert.doesNotMatch(textTestBody, /\$\{result\.message\}/);
});

test('connection-test save guard detects an unsafe function body', () => {
  const unsafeSource = 'async function testText() { await saveConfig({}); }';

  assert.throws(() => {
    assert.doesNotMatch(functionBody(unsafeSource, 'testText'), /\bsaveConfig\s*\(/);
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
