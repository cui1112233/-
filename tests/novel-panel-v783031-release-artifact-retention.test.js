'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, '.github/workflows/v88-linux-amd64-image-release.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

assert.match(workflow, /permissions:\s*[\s\S]*?contents:\s*read[\s\S]*?actions:\s*write/,
  'release workflow must have actions: write so it can prune old release artifacts');

const cleanupMarker = '- name: Prune old V88 AMD64 release artifacts';
const uploadMarker = '- name: Upload V88 AMD64 release artifact';
assert.ok(workflow.includes(cleanupMarker), 'release workflow must prune old V88 AMD64 artifacts before upload');
assert.ok(workflow.indexOf(cleanupMarker) < workflow.indexOf(uploadMarker), 'artifact pruning must run before upload');
assert.match(workflow, /actions\/github-script@v7/);
assert.match(workflow, /qiantie-v88-linux-amd64-/);
assert.match(workflow, /listArtifactsForRepo/);
assert.match(workflow, /deleteArtifact/);
assert.match(workflow, /keepLatest\s*=\s*2/,
  'retention cleanup should preserve the two newest V88 AMD64 release artifacts');

console.log('V78.3.0.31 release artifact retention regression: PASS');
