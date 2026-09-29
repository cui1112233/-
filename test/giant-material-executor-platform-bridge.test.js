const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildForwardRequest } = require('../lib/local-executor-device-forwarder');

const root = path.join(__dirname, '..');

test('platform mounts the giant material control-plane bridge before the generic Shuihuo router', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(source, /createGiantMaterialExecutorBridgeRouter/);
  assert.match(source, /app\.use\('\/api\/shuihuo-production',\s*apiAuth,\s*createGiantMaterialExecutorBridgeRouter/);
});

test('platform forwards giant material device calls to Go with the giant executor prefix', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(source, /createLocalExecutorDeviceRouter\(\{[\s\S]*?prefix:\s*'\/api\/giant-material-executor\/v1\//);
});

test('device forwarder accepts the giant material prefix and preserves bearer credentials', () => {
  const request = {
    method: 'POST',
    originalUrl: '/api/giant-material-executor/v1/pair',
    headers: {
      authorization: 'Bearer executor-token',
      'content-type': 'application/json'
    },
    body: { code: 'ABCD1234' }
  };
  const built = buildForwardRequest(request, 'http://backend:4000', { prefix: '/api/giant-material-executor/v1/' });
  assert.equal(built.options.path, '/api/giant-material-executor/v1/pair');
  assert.equal(built.options.headers.Authorization, 'Bearer executor-token');
  assert.equal(JSON.parse(built.body.toString('utf8')).code, 'ABCD1234');
});

test('production serves the Windows executor ZIP instead of falling through to the 404 handler', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(app, /createGiantMaterialExecutorDownloadsRouter/);
  assert.match(app, /downloads\/giant-material-executor/);
  assert.match(dockerfile, /COPY frontend\/public\/downloads\//);
});
