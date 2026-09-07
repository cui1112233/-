const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'v88-linux-amd64-image-release.yml'), 'utf8');
const workerOverlay = fs.readFileSync(path.join(root, 'deploy', 'v88-public', 'docker-compose.browser-worker.yml'), 'utf8');

function workflowRunBlock(stepName) {
  const marker = `      - name: ${stepName}\n`;
  const stepStart = workflow.indexOf(marker);
  assert.ok(stepStart >= 0, `必须找到 workflow step: ${stepName}`);

  const runMarker = '        run: |\n';
  const runStart = workflow.indexOf(runMarker, stepStart);
  assert.ok(runStart >= 0, `必须找到 ${stepName} 的 run block`);

  const contentStart = runStart + runMarker.length;
  const nextStep = workflow.indexOf('\n      - name:', contentStart);
  const raw = workflow.slice(contentStart, nextStep >= 0 ? nextStep : workflow.length);

  return raw
    .split('\n')
    .map(line => line.startsWith('          ') ? line.slice(10) : line)
    .join('\n');
}

function composeServiceBlock(source, serviceName) {
  const lines = source.split('\n');
  const marker = `  ${serviceName}:`;
  const start = lines.findIndex(line => line === marker);
  assert.ok(start >= 0, `必须找到 compose service: ${serviceName}`);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_.-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

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

test('正式发布必须用 release override 直接绑定精确 GHCR 镜像，不能 retag 到旧 service image', () => {
  const deploy = workflowRunBlock('Deploy verified images to V88 ECS');
  const verify = workflowRunBlock('Verify V88 ECS deployment');

  assert.match(deploy, /docker-compose\.release-images\.yml/, 'deploy 必须生成本次 release 专属 compose image override');
  assert.ok(
    deploy.includes("printf 'services:\\n  v88-node:\\n    image: %s\\n  novel-fetch-121-worker:\\n    image: %s\\n' \"$ghcr_image\" \"$worker_ghcr_image\" > \"$release_override\""),
    'release override 必须同时声明 v88-node 与 121 Worker，并写入本次精确 GHCR 镜像引用'
  );
  assert.match(deploy, /-f\s+[^\n]*docker-compose\.release-images\.yml/, 'compose up 必须加载 release image override');
  assert.doesNotMatch(deploy, /docker tag "\$ghcr_image" "\$service_image"/, '不能再把新主镜像 retag 到旧 service image 名称');
  assert.doesNotMatch(deploy, /docker tag "\$worker_ghcr_image" "\$worker_service_image"/, '不能再把新 Worker retag 到可变 latest 名称');

  assert.match(verify, /expected_node_image/, '验证阶段必须知道本次期望的主镜像');
  assert.match(verify, /expected_worker_image/, '验证阶段必须知道本次期望的 Worker 镜像');
  assert.match(verify, /\.Config\.Image/, '验证阶段必须核对容器实际 Config.Image');
  assert.match(verify, /127\.0\.0\.1:3000\/api\/novel-panel\/build-info/, '必须在 v88-node 容器内部先验证 build-info');
});

test('ECS deploy workflow shell 必须通过 bash -n 语法检查', () => {
  const deployScript = workflowRunBlock('Deploy verified images to V88 ECS');
  const result = spawnSync('bash', ['-n'], { input: deployScript, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout || 'bash -n failed');
});

test('121 Browser Worker 与 v88-node 必须显式共享 default 网络，保证容器 DNS 可解析', () => {
  const nodeBlock = composeServiceBlock(workerOverlay, 'v88-node');
  const workerBlock = composeServiceBlock(workerOverlay, 'novel-fetch-121-worker');
  assert.match(nodeBlock, /\n    networks:\n      default:/, 'v88-node 必须接入 overlay default 网络');
  assert.match(workerBlock, /\n    networks:\n      default:/, 'novel-fetch-121-worker 必须接入同一个 overlay default 网络');
  assert.match(nodeBlock, /QIANTIE_121_BROWSER_WORKER_URL: http:\/\/novel-fetch-121-worker:8787/);
});

test('发布失败时仍保留 release artifact 供人工恢复', () => {
  const uploadStart = workflow.indexOf('- name: Upload V88 AMD64 release artifact');
  assert.ok(uploadStart >= 0, '必须存在 release artifact 上传步骤');
  const prefix = workflow.slice(Math.max(0, uploadStart - 120), uploadStart + 300);
  assert.match(prefix, /if:\s*always\(\)/);
});
