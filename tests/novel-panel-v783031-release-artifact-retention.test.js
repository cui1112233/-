'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const retiredWorkflow = fs.readFileSync('.github/workflows/v88-linux-amd64-image-release.yml', 'utf8');
const unifiedWorkflow = fs.readFileSync('.github/workflows/v88-unified-public-image-release.yml', 'utf8');

assert.match(retiredWorkflow, /Retired/);
assert.doesNotMatch(retiredWorkflow, /packages:\s*write|docker\/login-action|docker push/);
assert.match(unifiedWorkflow, /packages: write/);
assert.match(unifiedWorkflow, /QIANTIE_RELEASE_SHA=\$\{\{ github\.sha \}\}/);
assert.match(unifiedWorkflow, /backend\/Dockerfile/);
console.log('V88 unified image release contract: PASS');
