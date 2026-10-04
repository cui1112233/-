const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const releaseDir = path.resolve(__dirname, '..', 'deploy', 'v88-public');

test('current release pointer and manifest use one verified immutable SHA', () => {
  const current = fs.readFileSync(path.join(releaseDir, 'CURRENT_RELEASE'), 'utf8').trim();
  assert.match(current, /^[0-9a-f]{40}$/);

  const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, 'releases', `${current}.manifest.json`), 'utf8'));
  assert.equal(manifest.release_sha, current);
  assert.equal(manifest.branch, 'v88');
  assert.equal(manifest.node_image, `ghcr.io/cui1112233/qiantie-v88-node:${current}`);
  assert.equal(manifest.go_image, `ghcr.io/cui1112233/qiantie-go-api:${current}`);
  assert.equal(manifest.verification.public_build_info.git_sha, current);
  assert.equal(manifest.verification.node_go_health.status, 200);
  assert.equal(manifest.verification.production_page.status, 200);
});

test('release manifest rejects a mismatched image SHA', () => {
  const current = fs.readFileSync(path.join(releaseDir, 'CURRENT_RELEASE'), 'utf8').trim();
  const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, 'releases', `${current}.manifest.json`), 'utf8'));
  assert.equal(manifest.node_image.split(':').at(-1), manifest.release_sha);
  assert.equal(manifest.go_image.split(':').at(-1), manifest.release_sha);
});

test('public Compose keeps component runtime identities explicit during an emergency repair', () => {
  const compose = fs.readFileSync(path.join(releaseDir, 'docker-compose.yml'), 'utf8');
  const nodeService = compose.split(/\r?\n  v88-node:\r?\n/)[1].split(/\r?\n  nginx:\r?\n/)[0];
  assert.match(nodeService, /QIANTIE_RELEASE_SHA:\s*\$\{QIANTIE_NODE_RELEASE_SHA:-\$\{QIANTIE_RELEASE_SHA\}\}/);
});

test('public Go runtime can read merged artifacts from the configured TOS client', () => {
  const compose = fs.readFileSync(path.join(releaseDir, 'docker-compose.yml'), 'utf8');
  const goService = compose.split(/\r?\n  go-api:\r?\n/)[1].split(/\r?\n  browser-worker:\r?\n/)[0];
  assert.match(goService, /QIANTIE_RELEASE_SHA:\s*\$\{QIANTIE_GO_RELEASE_SHA:-\$\{QIANTIE_RELEASE_SHA\}\}/);
  assert.match(goService, /QIANTIE_BATCH_FACTORY_V11_MERGE_TOS_ENDPOINT:/);
  assert.match(goService, /QIANTIE_REFERENCE_ASSET_TOS_ENDPOINT/);
  assert.match(goService, /QIANTIE_BATCH_FACTORY_V11_MERGE_TOS_BUCKET:/);
  assert.match(goService, /QIANTIE_REFERENCE_ASSET_TOS_BUCKET/);
});

test('release workflows preserve honest component identities', () => {
  const pairedWorkflow = fs.readFileSync(path.resolve(__dirname, '..', '.github', 'workflows', 'v88-runner-image-transport.yml'), 'utf8');
  assert.match(pairedWorkflow, /set_env QIANTIE_GO_RELEASE_SHA "\$expected_sha"/);

  const nodeOnlyWorkflow = fs.readFileSync(path.resolve(__dirname, '..', '.github', 'workflows', 'v88-unified-public-image-release.yml'), 'utf8');
  assert.match(nodeOnlyWorkflow, /set_env QIANTIE_NODE_RELEASE_SHA "\$expected_sha"/);
  assert.doesNotMatch(nodeOnlyWorkflow, /set_env QIANTIE_RELEASE_SHA "\$expected_sha"/);
});
