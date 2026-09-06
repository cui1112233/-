const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'v88-linux-amd64-image-release.yml'), 'utf8');

test('V88 ECS 发布对 GHCR 临时网络错误执行有限重试', () => {
  assert.match(workflow, /pull_with_retry\s*\(\)/);
  assert.match(workflow, /docker pull ["']?\$image/);
  assert.match(workflow, /pull_with_retry ["']\$ghcr_image["']/);
  assert.match(workflow, /pull_with_retry ["']\$worker_ghcr_image["']/);
  assert.match(workflow, /sleep/);
});

test('主镜像 GHCR 拉取持续失败时使用已生成 release tar 作为 fallback', () => {
  assert.match(workflow, /qiantie-v88-linux-amd64-\$\{SHORT_SHA\}\.tar\.gz/);
  assert.match(workflow, /scp[\s\S]*main_image_tar/);
  assert.match(workflow, /docker load\s+-i/);
  assert.match(workflow, /main_image_tar/);
});

test('ECS 必须先尝试 GHCR，再按需上传 68MB 主镜像 fallback', () => {
  const deployStart = workflow.indexOf('- name: Deploy verified images to V88 ECS');
  const verifyStart = workflow.indexOf('- name: Verify V88 ECS deployment');
  assert.ok(deployStart >= 0 && verifyStart > deployStart, '必须找到 ECS deploy step');
  const deploy = workflow.slice(deployStart, verifyStart);
  const pullIndex = deploy.indexOf('pull_with_retry "$ghcr_image"');
  const scpIndex = deploy.indexOf('"$main_image_tar" "$main_image_sha"');
  assert.ok(pullIndex >= 0, 'deploy step 必须先尝试主镜像 GHCR pull');
  assert.ok(scpIndex >= 0, '主镜像失败时必须保留 tar fallback 上传');
  assert.ok(pullIndex < scpIndex, '主镜像 GHCR pull 必须发生在 68MB fallback SCP 之前');
  assert.match(deploy, /Main GHCR pull failed|MAIN_PULL_FAILED|main_pull_status/);
});

test('发布失败时仍保留 release artifact 供人工恢复', () => {
  const uploadStart = workflow.indexOf('- name: Upload V88 AMD64 release artifact');
  assert.ok(uploadStart >= 0, '必须存在 release artifact 上传步骤');
  const prefix = workflow.slice(Math.max(0, uploadStart - 120), uploadStart + 300);
  assert.match(prefix, /if:\s*always\(\)/);
});
