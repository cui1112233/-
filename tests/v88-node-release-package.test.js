const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const packageScript = 'deploy/v88-direct/package-node-release.sh';
const stageWorkflow = '.github/workflows/v88-direct-deploy-node-stage.yml';
const stageHostScript = 'deploy/v88-direct/stage-node-host.sh';

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

test('Node release payload is whitelist-only and mirrors the production Node runtime surface', () => {
  const source = readIfExists(packageScript);
  assert.ok(source, 'package-node-release.sh must exist');

  for (const required of [
    'server.js', 'app.js', 'index.html', 'package.json', 'package-lock.json',
    'lib', 'middleware', 'pets', 'prompts', 'public', 'routes',
    'frontend/dist', 'node_modules', 'RELEASE-SHA', 'deploy/v88-direct/stage-node-host.sh'
  ]) {
    assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `whitelist must include ${required}`);
  }

  for (const forbidden of ['backend', 'docs', 'tests', '.github', 'services/121-browser-worker']) {
    assert.match(source, new RegExp(`forbid[^\\n]*${forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*forbid`, 'i'), `script must explicitly guard against packaging ${forbidden}`);
  }

  assert.doesNotMatch(source, /tar[^\n]*-czf[^\n]*\s\.\s*$/m, 'must never package the whole repository');
  assert.match(source, /PAYLOAD_BYTES|stat\s+-c/);
});

test('Node staging workflow uses whitelist packager and bounded resumable-friendly SSH chunk transfer', () => {
  const workflow = readIfExists(stageWorkflow);
  assert.ok(workflow, 'v88-direct-deploy-node-stage.yml must exist');
  assert.match(workflow, /package-node-release\.sh/);
  assert.doesNotMatch(workflow, /--exclude=['"]?\.git|tar\s+\\?[\s\S]{0,500}-czf[^\n]*\s\.\s*$/m, 'workflow must not build a whole-repo tarball');
  assert.doesNotMatch(workflow, /\bscp\b/, 'cross-region release transfer must not depend on one monolithic SCP/SFTP upload');
  assert.match(workflow, /split\s+-b\s+\d+[KMG]/, 'release payload must be split into bounded chunks');
  assert.match(workflow, /timeout\s+\d+\s+ssh/, 'remote transfer/control phases must stay bounded');
  assert.match(workflow, /cat\s+>[^\n]*source\.tar\.gz\.part-/, 'chunks must stream over the already-verified SSH command channel');
  assert.match(workflow, /sha256sum/, 'reassembled remote payload must be integrity checked');
  assert.match(workflow, /PAYLOAD_BYTES/);
});

test('Node staging workflow allows a bounded cold bootstrap window beyond four minutes', () => {
  const workflow = readIfExists(stageWorkflow);
  assert.ok(workflow, 'v88-direct-deploy-node-stage.yml must exist');
  const match = workflow.match(/REMOTE_STAGE_TIMEOUT_SECONDS:\s*(\d+)/);
  assert.ok(match, 'remote stage timeout must be declared explicitly');
  const timeoutSeconds = Number(match[1]);
  assert.ok(timeoutSeconds > 240, 'remote stage must allow cold bootstrap beyond four minutes');
  assert.ok(timeoutSeconds <= 1800, 'remote stage must still have a bounded timeout no greater than 30 minutes');
  assert.match(workflow, /timeout\s+"\$REMOTE_STAGE_TIMEOUT_SECONDS"\s+ssh[^\n]*bash\s+-s/, 'remote stage must enforce the declared timeout');
});

test('cold Node runtime download is retried and time bounded', () => {
  const source = readIfExists(stageHostScript);
  assert.ok(source, 'stage-node-host.sh must exist');
  assert.match(source, /curl[^\n]*--connect-timeout\s+10[^\n]*--max-time\s+180[^\n]*--retry\s+3[^\n]*nodejs\.org/, 'Node archive download must be retried and bounded');
  assert.match(source, /curl[^\n]*--connect-timeout\s+10[^\n]*--max-time\s+60[^\n]*--retry\s+3[^\n]*SHASUMS256/, 'Node checksum download must be retried and bounded');
});
