const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const overlay = fs.readFileSync(path.join(root, 'deploy', 'v88-public', 'docker-compose.browser-worker.yml'), 'utf8');
const stageHost = fs.readFileSync(path.join(root, 'deploy', 'v88-direct', 'stage-node-host.sh'), 'utf8');

function serviceBlock(source, serviceName) {
  const lines = source.split('\n').map(line => line.replace(/\r$/, ''));
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

test('V88 发布必须让 Node 与 121 Worker 共享同一组内部密钥，并由 Git-direct Stage 继承现网配置', () => {
  const node = serviceBlock(overlay, 'v88-node');
  const worker = serviceBlock(overlay, 'novel-fetch-121-worker');
  const secretNames = [
    'QIANTIE_121_WORKER_SECRET',
    'QIANTIE_121_CREDENTIAL_SECRET',
    'QIANTIE_121_STORAGE_STATE_SECRET',
  ];

  for (const secretName of secretNames) {
    const expectedPlaceholder = secretName + ': ${' + secretName + '}';
    assert.ok(node.includes(expectedPlaceholder), `Node 必须从共享配置注入 ${secretName}`);
    assert.ok(worker.includes(expectedPlaceholder), `121 Worker 必须从共享配置注入 ${secretName}`);
  }

  assert.match(node, /env_file:\s*\n\s*- \.\/novel-fetch-121\.env/);
  assert.match(worker, /env_file:\s*\n\s*- \.\/novel-fetch-121\.env/);

  assert.match(stageHost, /docker inspect -f '\{\{range \.Config\.Env\}\}\{\{println \.\}\}\{\{end\}\}' "\$node_id"/,
    'Git-direct Stage 必须从当前生产 Node 读取实际环境');
  assert.match(stageHost, /> "\$tmp_env"/,
    '继承的生产 Node 环境必须写入新的 Stage EnvironmentFile');
  assert.match(stageHost, /EnvironmentFile=\$STAGE_ENV/,
    'Stage systemd 服务必须使用继承后的环境文件');

  // Worker 内部鉴权密钥的权威来源必须是“正在运行的 Worker”，不能继续信任旧 Node 容器中的副本。
  assert.match(stageHost, /worker_secret=.*docker inspect[\s\S]*"\$worker_id"[\s\S]*QIANTIE_121_WORKER_SECRET/,
    'Stage 必须从当前运行的 Browser Worker 读取真实内部鉴权密钥');
  assert.match(stageHost, /grep -vE[^\n]*QIANTIE_121_WORKER_SECRET/,
    'Stage 必须过滤旧 Node 环境中的 Worker 鉴权密钥，避免漂移值覆盖真实值');
  assert.match(stageHost, /QIANTIE_121_WORKER_SECRET=\$worker_secret/,
    'Stage 必须把当前 Worker 的真实鉴权密钥写入新的 Node 环境');

  for (const secretName of ['QIANTIE_121_CREDENTIAL_SECRET', 'QIANTIE_121_STORAGE_STATE_SECRET']) {
    const exclusionPattern = new RegExp(`grep -vE[^\\n]*${secretName}`);
    assert.doesNotMatch(stageHost, exclusionPattern,
      `${secretName} 仍应从现网 Node 环境继承，当前没有证据需要替换`);
  }

  assert.match(stageHost, /QIANTIE_121_BROWSER_WORKER_URL=http:\/\/\$worker_ip:8787/,
    'Git-direct Node 必须继续连接现有的 121 Browser Worker，而不是重建另一套 Worker');
});
