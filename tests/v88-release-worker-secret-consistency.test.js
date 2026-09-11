'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const compose = fs.readFileSync('deploy/v88-public/docker-compose.yml', 'utf8');
const stageHost = fs.readFileSync('deploy/v88-direct/stage-node-host.sh', 'utf8');

function serviceBlock(source, serviceName) {
  const start = source.indexOf(`  ${serviceName}:`);
  assert.ok(start >= 0, `missing service ${serviceName}`);
  const next = source.slice(start + 1).search(/\n  [A-Za-z0-9_.-]+:\n/);
  return next < 0 ? source.slice(start) : source.slice(start, start + next + 1);
}

test('unified V88 Node and Browser Worker read one shared internal worker secret', () => {
  const node = serviceBlock(compose, 'v88-node');
  const worker = serviceBlock(compose, 'browser-worker');
  const secret = 'QIANTIE_121_WORKER_SECRET: ${QIANTIE_121_WORKER_SECRET}';
  assert.ok(node.includes(secret));
  assert.ok(worker.includes(secret));
  assert.match(node, /QIANTIE_121_BROWSER_WORKER_URL: http:\/\/browser-worker:8787/);
});

test('retired host staging cannot copy or override Worker credentials', () => {
  assert.match(stageHost, /Retired:/);
  assert.doesNotMatch(stageHost, /docker inspect|QIANTIE_121_WORKER_SECRET=/);
});
