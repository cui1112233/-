const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const overlay = fs.readFileSync(path.join(root, 'deploy', 'v88-public', 'docker-compose.browser-worker.yml'), 'utf8');
const stageHost = fs.readFileSync(path.join(root, 'deploy', 'v88-direct', 'stage-node-host.sh'), 'utf8');

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

test('V88 发布必须让 Node 与 121 Worker 共享同一组内部密钥，并由 Git-direct Stage 继承现网 Node 环境', () => {
  const node = serviceBlock(overlay, 'v88-node');
  const worker = serviceBlock(overlay, 'novel-fetch-121-worker');
  const secretNames = [
    'QIANTIE_121_WORKER_SECRET',
    'QIANTIE_121_CREDENTIAL_SECRET',
    'QIANTIE_121_STORAGE_STATE_SECRET',
  ];

  for (const secretName of secretNames) {
    const pattern = new RegExp(`${secretName}: \\${${secretName}}`);
    assert.match(node, pattern, `Node 必须从共享配置注入 ${secretName}`);
    assert.match(worker, pattern, `121 Worker 必须从共享配置注入 ${secretName}`);
  }

  assert.match(node, /env_file:\s*\n\s*- \.\/novel-fetch-121\.env/);
  assert.match(worker, /env_file:\s*\n\s*- \.\/novel-fetch-121\.env/);

  assert.match(stageHost, /docker inspect -f '\{\{range \.Config\.Env\}\}\{\{println \.\}\}\{\{end\}\}' "\$node_id"/,
    'Git-direct Stage 必须从当前生产 Node 读取实际环境');
  assert.match(stageHost, /> "\$tmp_env"/,
    '继承的生产 Node 环境必须写入新的 Stage EnvironmentFile');
  assert.match(stageHost, /EnvironmentFile=\$STAGE_ENV/,
    'Stage systemd 服务必须使用继承后的环境文件');

  for (const secretName of secretNames) {
    const exclusionPattern = new RegExp(`grep -vE[^\\n]*${secretName}`);
    assert.doesNotMatch(stageHost, exclusionPattern,
      `${secretName} 不得在 Git-direct Stage 的环境继承中过滤掉`);
  }

  assert.match(stageHost, /QIANTIE_121_BROWSER_WORKER_URL=http:\/\/\$worker_ip:8787/,
    'Git-direct Node 必须继续连接现有的 121 Browser Worker，而不是重建另一套 Worker');
});
