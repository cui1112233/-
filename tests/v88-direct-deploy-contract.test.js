const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const dockerReleasePath = '.github/workflows/v88-linux-amd64-image-release.yml';
const directDeployPath = '.github/workflows/v88-ecs-direct-deploy.yml';
const dockerRelease = fs.readFileSync(dockerReleasePath, 'utf8');
const directDeploy = fs.existsSync(directDeployPath) ? fs.readFileSync(directDeployPath, 'utf8') : '';

function workflowOnBlock(source) {
  const start = source.indexOf('\non:\n');
  assert.ok(start >= 0, 'workflow must contain on: block');
  const after = source.slice(start + 1);
  const nextTopLevel = after.slice(4).search(/^\S/m);
  return nextTopLevel >= 0 ? after.slice(0, 4 + nextTopLevel) : after;
}

test('routine Docker release no longer listens to v88 push', () => {
  const onBlock = workflowOnBlock(dockerRelease);
  assert.doesNotMatch(onBlock, /push:\s*[\s\S]*branches:\s*[\s\S]*- v88/);
  assert.match(onBlock, /workflow_dispatch:/);
});

test('direct deploy exists and deploys exact GITHUB_SHA', () => {
  assert.ok(directDeploy, 'direct deploy workflow must exist');
  assert.match(directDeploy, /branches:\s*\n\s*- v88/);
  assert.match(directDeploy, /GITHUB_SHA/);
  assert.match(directDeploy, /deploy\/v88-direct\/deploy\.sh/);
});

test('direct deploy does not build or publish Docker images', () => {
  assert.ok(directDeploy, 'direct deploy workflow must exist');
  assert.doesNotMatch(directDeploy, /docker build/);
  assert.doesNotMatch(directDeploy, /docker push/);
  assert.doesNotMatch(directDeploy, /docker pull/);
});
