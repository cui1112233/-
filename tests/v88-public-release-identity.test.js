const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await callback(server.address().port);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('Node runtime identity endpoint reports its injected immutable release SHA', async () => {
  const { createRuntimeBuildInfoHandler } = require('../lib/runtime-build-info');
  await withServer(createRuntimeBuildInfoHandler({ service: 'v88-node', releaseSha: 'abc123' }), async port => {
    const response = await fetch(`http://127.0.0.1:${port}/api/runtime-build-info`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { service: 'v88-node', git_sha: 'abc123' });
  });
});

test('paired image build workflow uses the checked-out SHA and immutable tags', () => {
  const nodeDockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const goDockerfile = fs.readFileSync(path.join(root, 'backend/Dockerfile'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/v88-unified-public-image-release.yml'), 'utf8');

  assert.match(nodeDockerfile, /ARG QIANTIE_RELEASE_SHA/);
  assert.match(goDockerfile, /ARG QIANTIE_RELEASE_SHA/);
  assert.match(nodeDockerfile, /org\.opencontainers\.image\.revision/);
  assert.match(goDockerfile, /org\.opencontainers\.image\.revision/);
  assert.match(workflow, /platforms:\s*linux\/amd64/);
  assert.match(workflow, /npm ci --omit=dev/);
  assert.match(workflow, /npm --prefix frontend ci/);
  assert.match(workflow, /npm --prefix frontend run build/);
  assert.match(workflow, /QIANTIE_RELEASE_SHA=\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /qiantie-v88-node:\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /qiantie-go-api:\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow, /latest/);
});
