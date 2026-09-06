'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, '.github/workflows/v88-linux-amd64-image-release.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

assert.match(workflow, /permissions:\s*[\s\S]*?contents:\s*read[\s\S]*?actions:\s*write[\s\S]*?packages:\s*write/,
  'release workflow must be able to prune artifacts and push GHCR images');

const cleanupMarker = '- name: Prune old V88 AMD64 release artifacts';
const loginMarker = '- name: Login to GHCR';
const pushMarker = '- name: Push V88 AMD64 images to GHCR';
const uploadMarker = '- name: Upload V88 AMD64 release artifact';
assert.ok(workflow.includes(cleanupMarker), 'release workflow must prune old V88 AMD64 artifacts before upload');
assert.ok(workflow.indexOf(cleanupMarker) < workflow.indexOf(uploadMarker), 'artifact pruning must run before upload');
assert.match(workflow, /actions\/github-script@v7/);
assert.match(workflow, /qiantie-v88-linux-amd64-/);
assert.match(workflow, /listArtifactsForRepo/);
assert.match(workflow, /deleteArtifact/);
assert.match(workflow, /keepLatest\s*=\s*2/,
  'retention cleanup should preserve the two newest V88 AMD64 release artifacts');

assert.ok(workflow.includes(loginMarker), 'release workflow must authenticate to GHCR');
assert.ok(workflow.includes(pushMarker), 'release workflow must push the immutable AMD64 image to GHCR');
assert.ok(workflow.indexOf(loginMarker) < workflow.indexOf(pushMarker), 'GHCR login must happen before push');
assert.match(workflow, /docker\/login-action@v3/);
assert.match(workflow, /registry:\s*ghcr\.io/);
assert.match(workflow, /GHCR_IMAGE/);
assert.match(workflow, /docker push "\$GHCR_IMAGE"/);
assert.match(workflow, /registry_image=\$\{GHCR_IMAGE\}/,
  'release metadata must record the durable GHCR image reference');

const uploadBlock = workflow.slice(workflow.indexOf(uploadMarker));
assert.match(uploadBlock, /continue-on-error:\s*true/,
  'artifact upload is a compatibility channel and must not block a verified GHCR release when quota is exhausted');

console.log('V78.3.0.31 release distribution regression: PASS');
