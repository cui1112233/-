const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const composePath = path.join(__dirname, '..', 'docker-compose.novel-fetch-v2-review.yml');

function composeSource() { return fs.readFileSync(composePath, 'utf8'); }

function serviceBlock(source, name, nextName) {
  const start = source.indexOf(`  ${name}:`);
  assert.ok(start >= 0, `missing service ${name}`);
  const end = nextName ? source.indexOf(`  ${nextName}:`, start + 1) : source.indexOf('\nnetworks:', start + 1);
  return source.slice(start, end >= 0 ? end : undefined);
}

test('review compose wires platform to private Browser Worker with required secrets', () => {
  const source = composeSource();
  const platform = serviceBlock(source, 'platform', 'novel-fetch-121-worker');
  const worker = serviceBlock(source, 'novel-fetch-121-worker');

  assert.match(platform, /QIANTIE_121_BROWSER_WORKER_URL:\s*http:\/\/novel-fetch-121-worker:8787/);
  assert.match(platform, /QIANTIE_121_WORKER_SECRET:\s*\$\{QIANTIE_121_WORKER_SECRET:\?required\}/);
  assert.match(platform, /QIANTIE_121_CREDENTIAL_SECRET:\s*\$\{QIANTIE_121_CREDENTIAL_SECRET:\?required\}/);
  assert.match(worker, /QIANTIE_121_WORKER_SECRET:\s*\$\{QIANTIE_121_WORKER_SECRET:\?required\}/);
  assert.match(worker, /QIANTIE_121_STORAGE_STATE_SECRET:\s*\$\{QIANTIE_121_STORAGE_STATE_SECRET:\?required\}/);
  assert.match(worker, /QIANTIE_121_HEADED_ENABLED:\s*"1"/);
  assert.doesNotMatch(source, /dev-bridge-secret-change-me/);
});

test('review compose exposes only the platform on localhost and never publishes worker port', () => {
  const source = composeSource();
  const platform = serviceBlock(source, 'platform', 'novel-fetch-121-worker');
  const worker = serviceBlock(source, 'novel-fetch-121-worker');

  assert.match(platform, /127\.0\.0\.1:\$\{QIANTIE_REVIEW_HOST_PORT:-13107\}:18081/);
  assert.doesNotMatch(platform, /127\.0\.0\.1:3000|:3000:/);
  assert.doesNotMatch(worker, /\n\s+ports:/);
  assert.match(worker, /\n\s+expose:\s*\n\s+-\s*"8787"/);
  assert.match(source, /driver:\s*bridge/);
  assert.doesNotMatch(source, /internal:\s*true/);
});

test('worker healthcheck authenticates with the same internal secret instead of weakening healthz auth', () => {
  const worker = serviceBlock(composeSource(), 'novel-fetch-121-worker');
  assert.match(worker, /x-qiantie-internal-secret/);
  assert.match(worker, /process\.env\.QIANTIE_121_WORKER_SECRET/);
  assert.match(worker, /\/healthz/);
});

test('review compose requires explicit temporary host data directories instead of production volumes', () => {
  const source = composeSource();
  assert.match(source, /\$\{QIANTIE_REVIEW_DATA_DIR:\?required\}:\/app\/data/);
  assert.match(source, /\$\{QIANTIE_REVIEW_WORKER_DATA_DIR:\?required\}:\/data/);
  assert.doesNotMatch(source, /mysql_data|production|prod-data/i);
});
