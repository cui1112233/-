const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('local executor status contract stays compatible with the script page', () => {
  const scriptSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'ScriptPage.jsx'),
    'utf8'
  );
  const serverSource = fs.readFileSync(
    path.join(__dirname, '..', 'backend', 'internal', 'httpapi', 'local_executor.go'),
    'utf8'
  );

  const scriptReadsExecutors = /const executors = Array\.isArray\(result\?\.executors\) \? result\.executors : \[\];/.test(scriptSource);
  const serverProvidesItemsAlias = /map\[string\]any\{"executors": executors, "items": executors\}/.test(serverSource);

  assert.ok(
    scriptReadsExecutors || serverProvidesItemsAlias,
    'GET /api/shuihuo-production/local-executors must be compatible with the script page executor list field'
  );
});
