const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('script page reads paired local executors from the executors response field', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'ScriptPage.jsx'),
    'utf8'
  );

  assert.match(
    source,
    /const executors = Array\.isArray\(result\?\.executors\) \? result\.executors : \[\];/,
    'ScriptPage must read GET /api/shuihuo-production/local-executors from result.executors'
  );
});
