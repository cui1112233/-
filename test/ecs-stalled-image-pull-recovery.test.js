const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'v88-ecs-stalled-image-pull-recovery.yml');

test('stalled image-pull recovery requires an exact SHA and explicit confirmation', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /stale_release_sha:/);
  assert.match(workflow, /STOP_STALLED_PULL_ONLY/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/v88'/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /docker pull/);
  assert.match(workflow, /kill -TERM/);
  assert.match(workflow, /ECS_STALLED_PULL_RECOVERY_OK/);
  assert.doesNotMatch(workflow, /systemctl|service |docker (restart|stop|rm|compose|system prune|image prune|container prune|builder prune)/);
});
