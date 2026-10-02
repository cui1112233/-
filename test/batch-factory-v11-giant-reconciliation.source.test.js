const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'batch-factory-v11.js'), 'utf8');

test('server giant OCR reconciliation calls the signed Go executor route', () => {
  assert.match(source, /reconcileGiantMaterialSource:[\s\S]*?\/api\/shuihuo-production\/giant-material-jobs\/\$\{encodeURIComponent\(executorJobId\)\}/);
  assert.doesNotMatch(source, /pathname: `\/api\/giant-material-jobs\/\$\{encodeURIComponent\(executorJobId\)\}`/);
});
