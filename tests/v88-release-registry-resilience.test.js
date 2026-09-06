const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'v88-linux-amd64-image-release.yml'), 'utf8');

test('V88 ECS 发布对 GHCR 临时网络错误执行有限重试', () => {
  assert.match(workflow, /pull_with_retry\s*\(\)/);
  assert.match(workflow, /docker pull ["']?\$ghcr_image/);
  assert.match(workflow, /docker pull ["']?\$worker_ghcr_image/);
  assert.match(workflow, /sleep/);
});

test('主镜像 GHCR 拉取持续失败时使用已生成 release tar 作为 fallback', () => {
  assert.match(workflow, /qiantie-v88-linux-amd64-\$\{SHORT_SHA\}\.tar\.gz/);
  assert.match(workflow, /scp[\s\S]*qiantie-v88-linux-amd64/);
  assert.match(workflow, /docker load\s+-i/);
  assert.match(workflow, /main_image_tar/);
});
