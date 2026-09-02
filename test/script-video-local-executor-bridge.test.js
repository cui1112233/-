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

test('script page remembers the selected single-shot video model after refresh', () => {
  const pageSource = source('frontend/src/user/pages/ScriptPage.jsx');

  assert.match(pageSource, /scriptVideoModelKey,\s*$/m, 'draft snapshot must include scriptVideoModelKey');
  assert.match(
    pageSource,
    /setScriptVideoModelKey\(restoredDraft\.scriptVideoModelKey\s*\|\|\s*['"]yd2-mini-video['"]\)/,
    'draft restore must restore the selected video model'
  );
  assert.match(
    pageSource,
    /\[extractInfo, output, editingOutput, generationStage, constraints, shotVideoTasks, scriptVideoModelKey\]/,
    'changing the video model must trigger draft persistence'
  );
});
