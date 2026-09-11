'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const workflow = fs.readFileSync('.github/workflows/v88-unified-public-image-release.yml', 'utf8');
const compose = fs.readFileSync('deploy/v88-public/docker-compose.yml', 'utf8');
const nginx = fs.readFileSync('deploy/v88-public/nginx.conf', 'utf8');

test('V88 public deployment builds paired images and exposes only the unified Nginx entry', () => {
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /qiantie-v88-node/);
  assert.match(workflow, /qiantie-go-api/);
  assert.match(compose, /ports:\s*\n\s*- "3000:80"/);
  assert.match(nginx, /proxy_pass http:\/\/v88-node:3000;/);
  assert.doesNotMatch(nginx, /18081|172\.19\.|go-api:4000/);
});
