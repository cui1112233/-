const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const workflow = fs.readFileSync('.github/workflows/v88-unified-public-image-release.yml', 'utf8');

test('unified V88 release can be explicitly requested from v88 without using retired host-stage paths', () => {
  assert.match(workflow, /push:\s*[\s\S]*branches:\s*\[?v88\]?/);
  assert.match(workflow, /if: github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /deploy\/v88-public\/UNIFIED-DEPLOY-REQUEST/);
  assert.doesNotMatch(workflow, /stage-node-host\.sh|cutover-node-host\.sh/);
  assert.doesNotMatch(workflow, /(?:curl|proxy_pass)[^\n]*18081/);
});

test('unified V88 release deploys the paired immutable Node and Go images from the same SHA', () => {
  assert.match(workflow, /qiantie-v88-node:\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /qiantie-go-api:\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /deploy:\s*[\s\S]*needs:\s*release/);
  assert.match(workflow, /QIANTIE_NODE_IMAGE/);
  assert.match(workflow, /QIANTIE_GO_IMAGE/);
  assert.match(workflow, /QIANTIE_RELEASE_SHA/);
  assert.match(workflow, /docker compose[^\n]*config -q/);
  assert.match(workflow, /up -d[^\n]*go-api v88-node/);
});

test('unified V88 deploy records rollback state and restores it on failed acceptance', () => {
  assert.match(workflow, /PREVIOUS_PUBLIC_BUILD/);
  assert.match(workflow, /backup_env/);
  assert.match(workflow, /rollback/);
  assert.match(workflow, /cp -a "\$backup_env" \.env/);
});

test('unified V88 deploy installs the Git-managed Nginx route and restores it on failed acceptance', () => {
  assert.match(workflow, /scp[\s\S]*deploy\/v88-public\/nginx\.conf/);
  assert.match(workflow, /backup_nginx/);
  assert.match(workflow, /cp -a "\$backup_nginx" nginx\.conf/);
  assert.match(workflow, /trap rollback EXIT/);
  assert.match(workflow, /trap - EXIT ERR/);
  assert.doesNotMatch(workflow, /trap rollback ERR/);
  assert.match(workflow, /docker compose[^\n]*up -d[^\n]*--force-recreate[^\n]*nginx/);
  assert.match(workflow, /ECS_PUBLIC_HOST/);
  assert.match(workflow, /docker compose[^\n]*exec -T nginx nginx -t/);
  assert.match(workflow, /nginx\.conf\.pre-unified-20260912T103106Z/);
});

test('unified V88 deploy verifies the recreated Nginx container is serving the Git-managed Node route', () => {
  assert.match(workflow, /nginx_id_before=.*docker compose[^\n]*ps -q nginx/);
  assert.match(workflow, /nginx_id_after=.*docker compose[^\n]*ps -q nginx/);
  assert.match(workflow, /if \[ "\$nginx_id_before" = "\$nginx_id_after" \]/);
  assert.match(workflow, /nginx -T[^\n]*proxy_pass http:\/\/v88-node:3000/);
  assert.match(workflow, /STATUS=FAILED running Nginx route did not converge/);
});

test('unified V88 deploy rolls back if the runner external verification rejects a release', () => {
  assert.match(workflow, /id: deploy_public/);
  assert.match(workflow, /name: Roll back ECS after external rejection/);
  assert.match(workflow, /if: failure\(\) && steps\.deploy_public\.outcome == 'success'/);
});

test('unified V88 deploy accepts the public runtime only when exact release identity and Batch Factory routes are reachable', () => {
  assert.match(workflow, /api\/build-info/);
  assert.match(workflow, /batch-factory/);
  assert.match(workflow, /api\/batch-factory\/v11\/capabilities/);
  assert.match(workflow, /expected_sha/);
});

test('unified V88 deploy feeds smoke scripts and JSON through unambiguous stdin channels', () => {
  assert.match(workflow, /docker exec -i "\$node_id" node -/);
  assert.doesNotMatch(workflow, /python3 - "\$expected_sha" <[^\n]+ <<['"]?PY/);
  assert.match(workflow, /python3 -c ['"][^\n]*json\.load\(sys\.stdin\)[^\n]*['"] "\$expected_sha" <\/tmp\/v88-public-build\.json/);
});
