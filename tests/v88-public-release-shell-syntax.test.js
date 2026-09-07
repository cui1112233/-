const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function extractRunBlock(source, stepName) {
  const lines = source.split(/\r?\n/);
  const stepIndex = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  assert.notEqual(stepIndex, -1, `step not found: ${stepName}`);

  const runIndex = lines.findIndex((line, index) => index > stepIndex && line.trim() === 'run: |');
  assert.notEqual(runIndex, -1, `run block not found: ${stepName}`);

  const runIndent = lines[runIndex].match(/^\s*/)[0].length;
  const body = [];
  for (let index = runIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && line.match(/^\s*/)[0].length <= runIndent) break;
    body.push(line);
  }

  const nonEmpty = body.filter((line) => line.trim());
  const bodyIndent = Math.min(...nonEmpty.map((line) => line.match(/^\s*/)[0].length));
  return body.map((line) => line.slice(Math.min(bodyIndent, line.length))).join('\n');
}

test('V88 ECS deploy workflow shell parses before release', () => {
  const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'v88-linux-amd64-image-release.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const script = extractRunBlock(workflow, 'Deploy verified images to V88 ECS');
  const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || 'bash -n failed');
});
