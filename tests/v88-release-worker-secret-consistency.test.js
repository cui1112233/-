const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'v88-linux-amd64-image-release.yml'), 'utf8');
const overlay = fs.readFileSync(path.join(root, 'deploy', 'v88-public', 'docker-compose.browser-worker.yml'), 'utf8');

function serviceBlock(source, serviceName) {
  const lines = source.split('\n');
  const start = lines.findIndex(line => line === `  ${serviceName}:`);
  assert.ok(start >= 0, `missing service ${serviceName}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^  [A-Za-z0-9_.-]+:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function stepBlock(name, nextName) {
  const start = workflow.indexOf(`- name: ${name}`);
  const end = workflow.indexOf(`- name: ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `missing workflow step ${name}`);
  return workflow.slice(start, end);
}

test('V88 发布必须让 Node 与 121 Worker 从同一 compose env-file 注入内部密钥', () => {
  const node = serviceBlock(overlay, 'v88-node');
  const worker = serviceBlock(overlay, 'novel-fetch-121-worker');

  for (const block of [node, worker]) {
    assert.match(block, /QIANTIE_121_WORKER_SECRET: \$\{QIANTIE_121_WORKER_SECRET\}/);
    assert.match(block, /QIANTIE_121_CREDENTIAL_SECRET: \$\{QIANTIE_121_CREDENTIAL_SECRET\}/);
    assert.match(block, /QIANTIE_121_STORAGE_STATE_SECRET: \$\{QIANTIE_121_STORAGE_STATE_SECRET\}/);
  }

  const canonicalEnv = '--env-file "$compose_dir/novel-fetch-121.env"';
  const deploy = stepBlock('Deploy verified images to V88 ECS', 'Verify V88 ECS deployment');
  const verify = stepBlock('Verify V88 ECS deployment', 'Rollback V88 ECS on failed verification');
  const rollback = stepBlock('Rollback V88 ECS on failed verification', 'Prune old V88 AMD64 release artifacts');

  for (const [name, block] of [['deploy', deploy], ['verify', verify], ['rollback', rollback]]) {
    assert.ok(block.includes(canonicalEnv), `${name} 必须使用同一 novel-fetch-121.env 做 Compose 插值`);
  }
  assert.match(deploy, /docker-compose\.release-images\.yml/, 'deploy 可以额外叠加精确镜像 override，但不能绕过共享 env-file');
  assert.match(verify, /docker-compose\.release-images\.yml/, 'verify 必须用同一个精确镜像 override 与共享 env-file');
});
