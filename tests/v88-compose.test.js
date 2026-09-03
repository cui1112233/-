const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const composePath = path.join(__dirname, '..', 'docker-compose.v88-review.yml');
const envPath = path.join(__dirname, '..', '.env.v88-review.example');
const workerDockerfilePath = path.join(__dirname, '..', 'services', '121-browser-worker', 'Dockerfile');

test('V88 review compose wires platform, Go, MySQL, and private 121 worker safely', () => {
  const yaml = fs.readFileSync(composePath, 'utf8');
  assert.match(yaml, /name:\s*qiantie-v88-review/);
  for (const service of ['platform:', 'backend:', 'mysql:', 'novel-fetch-121-worker:']) {
    assert.match(yaml, new RegExp('^  ' + service.replace(':', '\\:'), 'm'));
  }
  assert.match(yaml, /127\.0\.0\.1:\$\{QIANTIE_V88_HOST_PORT:-13188\}:18081/);
  assert.doesNotMatch(yaml, /127\.0\.0\.1:\$\{QIANTIE_V88_HOST_PORT:-13188\}:3000/);
  assert.match(yaml, /QIANTIE_GO_BASE_URL:\s*http:\/\/backend:4000/);
  assert.match(yaml, /QIANTIE_BRIDGE_SECRET:\s*\$\{QIANTIE_V88_BRIDGE_SECRET:\?required\}/);
  assert.match(yaml, /QIANTIE_MYSQL_DSN:.*@tcp\(mysql:3306\)/);
  assert.match(yaml, /QIANTIE_BATCH_FACTORY_V11_SLICE:\s*\$\{QIANTIE_V88_SLICE:-4\}/);
  const backendSection = yaml.split(/\n  backend:\s*/)[1]?.split(/\n  platform:\s*/)[0] || '';
  assert.match(backendSection, /healthcheck:[\s\S]*test:[\s\S]*\/qiantie[\s\S]*healthcheck/);
  assert.match(yaml, /novel-fetch-121-worker:[\s\S]*?expose:\s*\n\s*- ["']?8787/);
  const workerSection = yaml.split(/\n  novel-fetch-121-worker:\s*/)[1] || '';
  assert.doesNotMatch(workerSection.split(/\n  [a-z0-9-]+:\s*\n/)[0], /\n\s+ports:/);
  assert.match(yaml, /QIANTIE_121_HEADED_ENABLED:\s*["']1["']/);
  assert.match(yaml, /x-qiantie-internal-secret/);
  const workerDockerfile = fs.readFileSync(workerDockerfilePath, 'utf8');
  assert.match(workerDockerfile, /COPY start-worker\.sh \.\/start-worker\.sh/);
  assert.match(workerDockerfile, /CMD \[["']\.\/start-worker\.sh["']\]/);
  for (const variable of ['QIANTIE_V88_DATA_DIR', 'QIANTIE_V88_MYSQL_DATA_DIR', 'QIANTIE_V88_WORKER_DATA_DIR', 'QIANTIE_V88_BRIDGE_SECRET']) {
    assert.match(yaml, new RegExp('\\$\\{' + variable + ':\\?required\\}'));
  }
});

test('V88 review env template is explicitly non-production and fail-closed', () => {
  const env = fs.readFileSync(envPath, 'utf8');
  assert.match(env, /temporary|review|候选/i);
  assert.match(env, /QIANTIE_V88_HOST_PORT=13188/);
  assert.match(env, /QIANTIE_V88_DATA_DIR=/);
  assert.match(env, /QIANTIE_V88_MYSQL_DATA_DIR=/);
  assert.match(env, /QIANTIE_V88_WORKER_DATA_DIR=/);
  assert.match(env, /QIANTIE_V88_BRIDGE_SECRET=/);
  assert.match(env, /QIANTIE_V88_TEXT_ENDPOINT=/);
  assert.match(env, /QIANTIE_V88_TEXT_API_KEY=/);
  assert.match(env, /QIANTIE_V88_TEXT_MODEL=/);
});
