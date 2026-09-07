'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const retiredWorkflow = fs.readFileSync(
  path.join(root, '.github/workflows/v88-linux-amd64-image-release.yml'),
  'utf8',
);
const stageWorkflow = fs.readFileSync(
  path.join(root, '.github/workflows/v88-direct-deploy-node-stage.yml'),
  'utf8',
);
const cutoverWorkflow = fs.readFileSync(
  path.join(root, '.github/workflows/v88-direct-deploy-node-cutover.yml'),
  'utf8',
);

assert.match(retiredWorkflow, /V88 Linux AMD64 Public Image Release \(Retired\)/);
assert.match(retiredWorkflow, /automatic Docker\/GHCR V88 public release path is retired/);
assert.match(retiredWorkflow, /Use V88 Direct Deploy Node Stage and V88 Direct Deploy Node Cutover/);
assert.doesNotMatch(retiredWorkflow, /packages:\s*write/,
  'retired image workflow must not retain package-publish permission');
assert.doesNotMatch(retiredWorkflow, /actions:\s*write/,
  'retired image workflow must not retain artifact-delete permission');
assert.doesNotMatch(retiredWorkflow, /docker\/login-action|docker push|ghcr\.io/,
  'retired image workflow must not publish Docker images');

assert.match(stageWorkflow, /deploy\/v88-direct\/STAGE-REQUEST/,
  'current release must be explicitly marker-gated before staging');
assert.match(stageWorkflow, /package-node-release\.sh/,
  'current release must build the whitelisted Git-direct Node payload');
assert.match(stageWorkflow, /Stage exact SHA without cutting public traffic/,
  'staging must remain parallel and must not cut public traffic');

assert.match(cutoverWorkflow, /deploy\/v88-direct\/CUTOVER-REQUEST/,
  'public cutover must use a separate marker');
assert.match(cutoverWorkflow, /cutover-node-host\.sh/,
  'current release must use the guarded Node cutover helper');

console.log('V88 Git-direct release retirement/distribution regression: PASS');
