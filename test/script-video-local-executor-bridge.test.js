const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('script local Doubao video submits into the real local-executor queue', () => {
  const routeSource = source('routes/script-video.js');
  assert.match(routeSource, /LOCAL_DOUBAO_MODEL_KEY\s*=\s*'local-doubao-executor-video'/);
  assert.match(routeSource, /localExecutorRequest\(req,\s*'\/api\/shuihuo-production\/local-executor-jobs',\s*\{\s*method:\s*'POST'/);
  assert.doesNotMatch(routeSource, /fetch\([^)]*\/api\/script-videos\/local/);
});

test('script local Doubao video status and download resolve the local job artifact', () => {
  const routeSource = source('routes/script-video.js');
  assert.match(routeSource, /localExecutorRequest\(req,\s*`\/api\/shuihuo-production\/local-executor-jobs\/\$\{encodeURIComponent\(taskId\)\}`/);
  assert.match(routeSource, /localExecutorRequest\(req,\s*`\/api\/shuihuo-production\/local-executor-jobs\/\$\{encodeURIComponent\(taskId\)\}\/artifact`/);
});

test('script history upload caps novel text to the same 200k stored by the backend', () => {
  const historyApiSource = source('frontend/src/shared/api/history.js');
  const historyRouteSource = source('routes/history.js');
  assert.match(historyApiSource, /novelText:\s*String\(payload\.novelText\s*\|\|\s*''\)\.slice\(0,\s*200000\)/);
  assert.match(historyRouteSource, /novelText:\s*String\(input\.novelText\s*\|\|\s*''\)\.slice\(0,\s*200000\)/);
});

test('script shot cards expose real local executor progress and retry state', () => {
  const routeSource = source('routes/script-video.js');
  const cardsSource = source('frontend/src/user/components/ShotOutputCards.jsx');

  assert.match(routeSource, /executorState:\s*state/);
  assert.match(cardsSource, /getScriptVideoTask/);
  for (const stage of ['preparing', 'submitting', 'acceptance_unknown', 'generating', 'downloading', 'uploading']) {
    assert.match(cardsSource, new RegExp(stage));
  }
  assert.match(cardsSource, /正在提交视频任务/);
  assert.match(cardsSource, /已提交 · 等待执行器/);
  assert.match(cardsSource, /正在下载视频/);
  assert.match(cardsSource, /正在回传网站/);
  assert.match(cardsSource, /生成失败/);
  assert.match(cardsSource, /重新生成/);
});
