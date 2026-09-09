'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `missing async function ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart + 1, index);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

test('版本对应配置档必须通过单一权威保存链路持久化并采用服务端回读状态', () => {
  const html = fs.readFileSync(path.join(root, 'frontend/public/batch-rewrite/index.html'), 'utf8');
  const authorityPath = path.join(root, 'frontend/public/batch-rewrite/version-config-authority.js');

  assert.equal(fs.existsSync(authorityPath), true, 'missing version-config-authority.js');
  assert.match(html, /version-config-authority\.js/);

  const source = fs.readFileSync(authorityPath, 'utf8');
  const saveBody = functionBody(source, 'saveVersionConfigAuthority');
  const confirmBody = functionBody(source, 'confirmWebSubmitSelectionAuthority');

  assert.match(saveBody, /clearTimeout\(workFormSaveTimer\)/);
  assert.match(saveBody, /collectWorkFormState\(\)/);
  assert.match(saveBody, /syncFormToAppConfig\(\)/);
  assert.match(saveBody, /appConfig\.work_form\s*=\s*formState/);
  assert.match(saveBody, /appConfig\.web_submit\s*=\s*syncFormToWebSubmitConfig\(\)/);
  assert.match(saveBody, /api\(["']\/api\/config["']/);
  assert.match(saveBody, /state\.config\s*=\s*result\.config/);

  assert.match(confirmBody, /await saveVersionConfigAuthority\(\)/);
  assert.doesNotMatch(confirmBody, /saveWorkFormStateNow\(/);
  assert.doesNotMatch(confirmBody, /saveWebSubmitConfig\(/);
});
