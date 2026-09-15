import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.resolve(here, '..');
const frontendDir = path.resolve(here, '../../../..');
const repoDir = path.resolve(frontendDir, '..');
const appSource = fs.readFileSync(path.join(frontendDir, 'src/user/App.jsx'), 'utf8');

function readRequired(relativePath) {
  return fs.readFileSync(path.join(frontendDir, relativePath), 'utf8');
}

test('novel fetch route installs the hardened 121 login guard', () => {
  assert.match(appSource, /const NovelFetchPage = lazy\(\(\) => import\('\.\/pages\/NovelFetchPage'\)\);/);
  assert.match(appSource, /'\/novel-fetch': NovelFetchPage/);

  const pageSource = fs.readFileSync(path.join(pagesDir, 'NovelFetchPage.jsx'), 'utf8');
  assert.match(pageSource, /batch-rewrite\/index\.html/);
});

test('novel fetch keeps a visible loading experience until the iframe is ready', () => {
  const pageSource = fs.readFileSync(path.join(pagesDir, 'NovelFetchPage.jsx'), 'utf8');
  const styleSource = fs.readFileSync(path.join(pagesDir, 'novel-fetch.css'), 'utf8');
  assert.match(pageSource, /novel-fetch-loading-overlay/);
  assert.match(pageSource, /正在加载小说获取/);
  assert.match(pageSource, /onError/);
  assert.match(pageSource, /setFrameError/);
  assert.match(styleSource, /novel-fetch-loading-overlay/);
  assert.match(styleSource, /novel-fetch-loader-trace/);
  assert.match(styleSource, /prefers-reduced-motion/);
});

test('121 guard fails closed when batch rewrite config is unavailable', () => {
  const source = readRequired('public/batch-rewrite/121-login-hotfix.js');
  assert.match(source, /state\.config\?\.web_submit/);
  assert.match(source, /ensureServerConfig/);
  assert.match(source, /已阻止发送 121 账号密码/);
  assert.match(source, /配置加载失败/);
  assert.match(source, /stopImmediatePropagation/);
  assert.match(source, /qiantieSafeLoginBound/);
});

test('121 guard keeps a 65 second frontend deadline above active worker budgets', () => {
  const source = readRequired('public/batch-rewrite/121-login-hotfix.js');
  assert.match(source, /REQUEST_TIMEOUT_MS\s*=\s*65_?000/);
  assert.match(source, /AbortController/);
  assert.match(source, /REQUEST_TIMEOUT_SECONDS\s*=\s*Math\.ceil\(REQUEST_TIMEOUT_MS\s*\/\s*1000\)/);
});

test('121 backend transport also defaults to a 15 second deadline', () => {
  const source = fs.readFileSync(path.join(repoDir, 'lib/target-upload.js'), 'utf8');
  assert.match(source, /timeoutMs\s*=\s*15000/);
});

test('candidate image injects the guard even when tracked frontend dist is stale', () => {
  const dockerfile = fs.readFileSync(path.join(repoDir, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /COPY frontend\/public\/batch-rewrite\/121-login-hotfix\.js/);
  assert.match(dockerfile, /qiantie-121-login-hotfix/);
  assert.match(dockerfile, /frontend\/dist\/batch-rewrite\/index\.html/);
});

test('novel status center survives frontend rebuild and unified image packaging', () => {
  const source = readRequired('public/batch-rewrite/v88-novel-status-center.js');
  assert.match(source, /V88NovelStatusCenter/);
  assert.match(source, /处理完成/);
  assert.match(source, /视频管理系统提交/);

  const workflow = fs.readFileSync(path.join(repoDir, '.github/workflows/v88-unified-public-image-release.yml'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(repoDir, 'Dockerfile'), 'utf8');
  assert.match(workflow, /npm --prefix frontend run build/);
  assert.match(dockerfile, /COPY frontend\/dist\/ \.\/frontend\/dist\//);
});

test('saving 121 credentials does not launch a second headed verification automatically', () => {
  const source = readRequired('public/batch-rewrite/121-login-hotfix.js');
  const submitStart = source.indexOf("dialog.addEventListener('submit'");
  const submitEnd = source.indexOf("}, true);", submitStart);
  assert.ok(submitStart >= 0 && submitEnd > submitStart, 'login submit handler must remain present');
  const submitHandler = source.slice(submitStart, submitEnd);
  assert.match(submitHandler, /api\('\/api\/web-submit\/config'/);
  assert.doesNotMatch(submitHandler, /test-visible/);
  const appSource = readRequired('public/batch-rewrite/app.js');
  assert.match(appSource, /testVisibleWebFlow/);
  assert.match(appSource, /\/api\/batch-rewrite\/web-submit\/test-visible/);
});
