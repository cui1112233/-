'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const releasePath = path.join(root, 'public/novel-panel/workbench/clean-core/release.js');
const runtimePath = path.join(root, 'public/novel-panel/workbench/v783031-runtime.js');
const serverPath = path.join(root, 'server.js');
const buildInfoPath = path.join(root, 'lib/novel-panel/v783031-build-info.js');

const release = fs.readFileSync(releasePath, 'utf8');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const server = fs.readFileSync(serverPath, 'utf8');

assert.match(release, /const VERSION="v78\.3\.0\.31",BUILD="v78\.3\.0\.31-final-semantics-20260906-r1"/);
assert.match(release, /label:"V78\.3\.0\.31/);
assert.match(release, /__VIDEO_PROMPT_TOOL_BUILD__/);
assert.match(release, /__V78_CURRENT_RUNTIME__/);
assert.match(release, /dataset\.runtimeVersion=VERSION/);
assert.match(runtime, /V='v78\.3\.0\.31'/);
assert.match(runtime, /__V78_STYLE_FIELD_BOUNDARY_FIX__/);

assert.ok(fs.existsSync(buildInfoPath), 'V31 build-info authority middleware must exist');
const { createV783031BuildInfoMiddleware, V783031_BUILD_INFO_PATCH } = require(buildInfoPath);
assert.equal(V783031_BUILD_INFO_PATCH.app_version, 'v78.3.0.31');
assert.equal(V783031_BUILD_INFO_PATCH.release_version, 'v78.3.0.31');
assert.equal(V783031_BUILD_INFO_PATCH.build_id, 'v78.3.0.31-final-semantics-20260906-r1');
assert.equal(V783031_BUILD_INFO_PATCH.workspace_schema_version, 40);

let emitted;
const res = {
  json(body) {
    emitted = body;
    return body;
  },
};
const middleware = createV783031BuildInfoMiddleware();
let nextCalled = false;
middleware({ method: 'GET' }, res, () => { nextCalled = true; });
assert.equal(nextCalled, true, 'build-info overlay must continue into the existing core route');
res.json({
  app_version: 'v78.3.0.2',
  release_version: 'v78.3.0.2',
  build_id: 'legacy',
  workspace_schema_version: 40,
  release_status: 'production',
  existing_capability: 'kept',
});
assert.equal(emitted.app_version, 'v78.3.0.31');
assert.equal(emitted.release_version, 'v78.3.0.31');
assert.equal(emitted.build_id, 'v78.3.0.31-final-semantics-20260906-r1');
assert.equal(emitted.workspace_schema_version, 40);
assert.equal(emitted.existing_capability, 'kept', 'identity overlay must preserve legacy build-info capabilities');

const mount = "app.use('/api/novel-panel/build-info', createV783031BuildInfoMiddleware());";
assert.ok(server.includes(mount), 'server must mount the V31 build-info overlay');
assert.ok(server.indexOf(mount) < server.indexOf('app.use(coreApp);'), 'V31 build-info overlay must run before coreApp');

console.log('V78.3.0.31 public version identity regression: PASS');
