const test = require('node:test');
const assert = require('node:assert/strict');
const { appBuildInfo } = require('../app');

test('app build info exposes the direct-release SHA instead of masking it with legacy fields', () => {
  assert.deepEqual(appBuildInfo({ env: { QIANTIE_RELEASE_SHA: 'b89c6ff6' } }), {
    app_version: 'v78.3.0.3',
    build_id: 'v78.3.0.3-remote-workbench-20260819-r1',
    branch: 'v88',
    git_sha: 'b89c6ff6',
    deployed_at: '',
    deploy_mode: 'git-direct'
  });
});
