const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'v88-ecs-image-pull-diagnostic.yml');

test('ECS image pull diagnostic is manually triggered, SHA-validated, and read-only', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /release_sha:/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/v88'/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /ECS_PULL_DIAGNOSTIC_OK/);
  assert.match(workflow, /df -h \/ \/var\/lib\/docker/);
  assert.match(workflow, /df -ih \/ \/var\/lib\/docker/);
  assert.match(workflow, /docker system df --format/);
  assert.match(workflow, /docker container ls -a/);
  assert.match(workflow, /docker image ls --digests/);
  assert.match(workflow, /docker image ls -f dangling=true/);
  assert.match(workflow, /curl -sS -o \/dev\/null -w/);
  assert.match(workflow, /docker image inspect/);
  assert.doesNotMatch(workflow, /- name: Prepare pinned ECS SSH connection/);
  assert.doesNotMatch(workflow, /docker (pull|login|compose|system prune|image prune|container prune|builder prune)/);
  assert.doesNotMatch(workflow, /docker (rm|stop|restart|kill)/);
  assert.doesNotMatch(workflow, /\b(systemctl|service|kill|rm -rf)\b/);
});
