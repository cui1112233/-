const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const nodeDockerfile = fs.readFileSync('Dockerfile', 'utf8');
const goDockerfile = fs.readFileSync('backend/Dockerfile', 'utf8');
const workflow = fs.readFileSync('.github/workflows/v88-unified-public-image-release.yml', 'utf8');

test('paired public images both receive the immutable release revision label', () => {
  for (const source of [nodeDockerfile, goDockerfile]) {
    assert.match(source, /ARG QIANTIE_RELEASE_SHA/);
    assert.match(source, /org\.opencontainers\.image\.revision/);
    assert.match(source, /QIANTIE_RELEASE_SHA/);
  }
});

test('image workflow builds the checked-out frontend before publishing the Node image', () => {
  assert.match(workflow, /npm ci --omit=dev/);
  assert.match(workflow, /npm --prefix frontend ci/);
  assert.match(workflow, /npm --prefix frontend run build/);
  assert.match(workflow, /file: backend\/Dockerfile/);
});
