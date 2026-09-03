const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const path = require('node:path');

const testDir = __dirname;
const nginxPath = path.join(testDir, '..', 'deploy', 'v78-public', 'nginx.conf');

function readConfig() {
  return fs.readFileSync(nginxPath, 'utf8');
}

test('public nginx compresses browser assets and preserves reusable proxy connections', () => {
  const config = readConfig();

  assert.match(config, /gzip\s+on;/);
  assert.match(config, /gzip_vary\s+on;/);
  assert.match(config, /gzip_types[\s\S]*text\/javascript/);
  assert.match(config, /gzip_types[\s\S]*application\/javascript/);
  assert.match(config, /location\s+\^~\s+\/assets\//);
  assert.match(config, /location\s+\^~\s+\/assets\/[\s\S]*proxy_buffering\s+on;/);
  assert.match(config, /location\s+\^~\s+\/assets\/[\s\S]*proxy_set_header\s+Connection\s+"";/);
  assert.doesNotMatch(config, /proxy_set_header\s+Connection\s+"upgrade";/);
  assert.doesNotMatch(config, /proxy_set_header\s+Upgrade\s+\$http_upgrade;/);
});
