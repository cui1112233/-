const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('script local Doubao video submits into the real local-executor queue', () => {
  const routeSource = source('routes/script-video.js');

  assert.match(
    routeSource,
    /POST['"],\s*['"]\/api\/shuihuo-production\/local-executor-jobs['"]|method:\s*['"]POST['"][\s\S]{0,240}\/api\/shuihuo-production\/local-executor-jobs/,
    'local script video must create a Go local-executor job'
  );
  assert.doesNotMatch(
    routeSource,
    /bridgeJSON\([^\n]+['"]POST['"],\s*['"]\/api\/script-videos\/local['"]/,
    'the dead /api/script-videos/local bridge must not be used'
  );
});

test('script local Doubao video status and download resolve the local job artifact', () => {
  const routeSource = source('routes/script-video.js');

  assert.match(
    routeSource,
    /\/api\/shuihuo-production\/local-executor-jobs\/\$\{encodeURIComponent\(taskId\)\}/,
    'local task polling must read the Go local-executor job'
  );
  assert.match(
    routeSource,
    /\/api\/shuihuo-production\/local-executor-artifacts\/\$\{encodeURIComponent\(job\.artifactId\)\}/,
    'successful local task download must stream the bound artifact'
  );
});

test('history save failure cannot block a single-shot video submission', () => {
  const pageSource = source('frontend/src/user/pages/ScriptPage.jsx');

  assert.match(
    pageSource,
    /let historyId = ['"]['"];\s*try\s*{\s*historyId = await ensureCurrentHistory\(\);\s*}\s*catch\s*\([^)]*\)\s*{[\s\S]{0,240}?message\.warning\([\s\S]{0,160}?}\s*const result = await createScriptVideo\(\{ prompt, modelKey: scriptVideoModelKey }\);/,
    'video submission must continue even when saving history fails'
  );
});
