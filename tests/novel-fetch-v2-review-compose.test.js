const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'docker-compose.novel-fetch-v2-review.yml');

function composeText() {
  return fs.readFileSync(file, 'utf8');
}

test('review compose keeps Browser Worker private and uses isolated review data', () => {
  assert.equal(fs.existsSync(file), true, 'review compose file must exist');
  const text = composeText();
  assert.match(text, /browser-worker-121:/);
  const workerBlock = text.match(/\n  browser-worker-121:\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\n|\nnetworks:|\nvolumes:|$)/)?.[1] || '';
  assert.doesNotMatch(workerBlock, /^\s*ports:/m);
  assert.match(workerBlock, /QIANTIE_121_WORKER_SECRET:\s*\$\{QIANTIE_121_WORKER_SECRET:\?/);
  assert.match(workerBlock, /QIANTIE_121_STORAGE_SECRET:\s*\$\{QIANTIE_121_STORAGE_SECRET:\?/);
  assert.match(workerBlock, /\/data\/sessions/);
  assert.match(text, /worker-internal:[\s\S]*internal:\s*true/);
  assert.match(text, /\.\/\.tmp\/novel-fetch-v2-review/);
});

test('review platform talks to Worker by service name and never binds host port 3000', () => {
  const text = composeText();
  const platformBlock = text.match(/\n  platform-review:\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\n|\nnetworks:|\nvolumes:|$)/)?.[1] || '';
  assert.match(platformBlock, /QIANTIE_121_BROWSER_WORKER_URL:\s*http:\/\/browser-worker-121:8787/);
  assert.match(platformBlock, /QIANTIE_121_WORKER_SECRET:\s*\$\{QIANTIE_121_WORKER_SECRET:\?/);
  assert.match(platformBlock, /QIANTIE_BRIDGE_SECRET:\s*\$\{QIANTIE_BRIDGE_SECRET:\?/);
  assert.match(platformBlock, /QIANTIE_GO_BASE_URL:\s*\$\{QIANTIE_GO_BASE_URL:\?/);
  assert.match(platformBlock, /\$\{QIANTIE_REVIEW_PORT:-13107\}:18081/);
  assert.doesNotMatch(platformBlock, /3000:3000|:3000\b/);
  assert.match(platformBlock, /\.\/\.tmp\/novel-fetch-v2-review\/platform-data:\/app\/data/);
});
