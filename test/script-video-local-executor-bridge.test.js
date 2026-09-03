const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('script local Doubao video submits into the real local-executor queue', () => {
  const routeSource = source('routes/script-video.js');
  assert.match(routeSource, /req\.body\?\.modelKey === 'local-doubao-executor-video'/);
  assert.match(routeSource, /bridgeJSON\(shuihuoGateway,\s*req\.auth\.account,\s*'POST',\s*'\/api\/shuihuo-production\/local-executor-jobs'/);
  assert.doesNotMatch(routeSource, /fetch\([^)]*\/api\/script-videos\/local/);
});

test('script local Doubao video status and download resolve the local job artifact', () => {
  const routeSource = source('routes/script-video.js');
  assert.match(routeSource, /bridgeJSON\(shuihuoGateway,\s*req\.auth\.account,\s*'GET',\s*`\/api\/shuihuo-production\/local-executor-jobs\/\$\{encodeURIComponent\(taskId\)\}`/);
  assert.match(routeSource, /bridgeDownload\(shuihuoGateway,\s*req\.auth\.account,\s*`\/api\/shuihuo-production\/local-executor-artifacts\/\$\{encodeURIComponent\(job\.artifactId\)\}`/);
});

test('script history upload caps novel text to the same 200k stored by the backend', () => {
  const historyApiSource = source('frontend/src/shared/api/history.js');
  const historyRouteSource = source('routes/history.js');
  assert.match(historyApiSource, /const HISTORY_NOVEL_TEXT_LIMIT = 200000/);
  assert.match(historyApiSource, /entry\.novelText\.slice\(0,\s*HISTORY_NOVEL_TEXT_LIMIT\)/);
  assert.match(historyRouteSource, /novelText:\s*typeof novelText === 'string' \? novelText\.slice\(0,\s*200000\) : ''/);
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

test('public V78 serves the branded browser favicon from the built frontend', () => {
  const appSource = source('app.js');
  const htmlSource = source('frontend/index.html');
  const iconPath = path.join(__dirname, '..', 'frontend', 'public', 'yizhan-icon.png');
  const icon = fs.readFileSync(iconPath);

  assert.match(htmlSource, /<link rel="icon" type="image\/png" href="\/yizhan-icon\.png" \/>/);
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(appSource, /app\.get\('\/yizhan-icon\.png'/);
  assert.match(appSource, /sendFile\(path\.join\(frontendDist,\s*'yizhan-icon\.png'\)\)/);
});
