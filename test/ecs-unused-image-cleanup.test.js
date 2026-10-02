const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'v88-ecs-unused-image-cleanup.yml');

test('ECS image cleanup is manual, confirmed, and limited to unused images', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /confirm:/);
  assert.match(workflow, /PRUNE_UNUSED_IMAGES/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/v88'/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /docker image prune -a --force/);
  assert.match(workflow, /df -h \/ \/var\/lib\/docker/);
  assert.match(workflow, /docker system df --format/);
  assert.doesNotMatch(workflow, /docker (pull|login|compose|system prune|volume prune|container prune|builder prune|rm|stop|restart|kill)/);
  assert.doesNotMatch(workflow, /\b(systemctl|service|kill|rm -rf)\b/);
});
