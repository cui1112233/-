const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const composeFile = path.join(root, 'deploy/v88-public/docker-compose.yml');
const envFile = path.join(root, 'deploy/v88-public/.env.example');
const nginxFile = path.join(root, 'deploy/v88-public/nginx.conf');

function composeConfig() {
  return JSON.parse(execFileSync('docker', [
    'compose', '--env-file', envFile, '-f', composeFile, 'config', '--format', 'json',
  ], { cwd: root, encoding: 'utf8' }));
}

test('public Compose renders one DNS-only V88 request chain', () => {
  const config = composeConfig();
  const services = config.services;

  assert.deepEqual(Object.keys(services).sort(), ['browser-worker', 'go-api', 'nginx', 'v88-node']);
  assert.equal(services['v88-node'].environment.QIANTIE_GO_BASE_URL, 'http://go-api:4000');
  assert.equal(services['v88-node'].environment.QIANTIE_121_BROWSER_WORKER_URL, 'http://browser-worker:8787');
  assert.match(services['go-api'].environment.QIANTIE_MYSQL_DSN, /@tcp\(mysql:3306\)\//);
  assert.deepEqual(services.nginx.ports, [{ mode: 'ingress', target: 80, published: '3000', protocol: 'tcp' }]);
  assert.equal(services['v88-node'].build, undefined);
  assert.equal(services['go-api'].build, undefined);
  assert.equal(config.networks.qiantie_internal.external, true);
});

test('public Nginx proxies application requests only through the Node service', () => {
  const nginx = fs.readFileSync(nginxFile, 'utf8');

  assert.match(nginx, /proxy_pass http:\/\/v88-node:3000;/);
  assert.doesNotMatch(nginx, /proxy_pass http:\/\/go-api:4000;/);
  assert.doesNotMatch(nginx, /18081|172\.19\.|host\.docker\.internal/);
});
