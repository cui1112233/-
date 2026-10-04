const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Go runtime repair transports and recreates only the verified Go service', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '..', '.github', 'workflows', 'v88-go-runtime-repair.yml'),
    'utf8',
  );

  assert.match(workflow, /release_sha:/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /docker build --platform linux\/amd64[^\n]*qiantie-go-api:\$RELEASE_SHA"? backend/);
  assert.match(workflow, /docker cp go_binary_extract:\/qiantie \/tmp\/qiantie/);
  assert.match(workflow, /gzip -1 < \/tmp\/qiantie > \/tmp\/v88-go-binary\.gz/);
  assert.match(workflow, /sha256sum \/tmp\/qiantie > \/tmp\/v88-go-binary\.sha256/);
  assert.match(workflow, /org\.opencontainers\.image\.revision/);
  assert.doesNotMatch(workflow, /\\"org\.opencontainers\.image\.revision\\"/);
  assert.match(workflow, /set_env QIANTIE_GO_IMAGE "\$go_image"/);
  assert.match(workflow, /set_env QIANTIE_GO_RELEASE_SHA "\$expected_sha"/);
  assert.match(workflow, /up -d --no-deps --force-recreate --pull never go-api/);
  assert.match(workflow, /docker cp "\$compiled_binary" "\$patch_container:\/qiantie"/);
  assert.match(workflow, /chmod 0555 "\$compiled_binary"/);
  assert.match(workflow, /docker commit --change "LABEL org\.opencontainers\.image\.revision=\$expected_sha"/);
  assert.doesNotMatch(workflow, /docker save "qiantie-go-api:\$RELEASE_SHA"/);
  assert.doesNotMatch(workflow, /up -d --no-deps --force-recreate --pull never go-api browser-worker v88-node/);
  assert.match(workflow, /runtime-build-info/);
});
