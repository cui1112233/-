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

test('V88 发布必须让 Node 与 121 Worker 从同一 compose env-file 注入内部密钥', () => {
  const node = serviceBlock(overlay, 'v88-node');
  const worker = serviceBlock(overlay, 'novel-fetch-121-worker');

  for (const block of [node, worker]) {
    assert.match(block, /QIANTIE_121_WORKER_SECRET: \$\{QIANTIE_121_WORKER_SECRET\}/);
    assert.match(block, /QIANTIE_121_CREDENTIAL_SECRET: \$\{QIANTIE_121_CREDENTIAL_SECRET\}/);
    assert.match(block, /QIANTIE_121_STORAGE_STATE_SECRET: \$\{QIANTIE_121_STORAGE_STATE_SECRET\}/);
  }

  const canonical = 'compose=(docker compose --env-file "$compose_dir/novel-fetch-121.env" -f "$compose_file" -f "$compose_dir/docker-compose.browser-worker.yml")';
  assert.equal(workflow.split(canonical).length - 1, 3, 'deploy/verify/rollback 三处必须使用同一 env-file 做 Compose 插值');
});
