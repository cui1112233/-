const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const production = fs.readFileSync('deploy/docker-compose.production.yml', 'utf8');
const testCompose = fs.readFileSync('deploy/docker-compose.test.yml', 'utf8');
const example = fs.readFileSync('deploy/.env.production.example', 'utf8');

test('production compose owns dedicated persistent volumes and ports', () => {
  for (const volume of ['qiantie-production-mysql', 'qiantie-production-objects', 'qiantie-production-platform', 'qiantie-production-redis']) {
    assert.match(production, new RegExp(volume));
  }
  assert.match(production, /QIANTIE_PLATFORM_PORT:-3000/);
  assert.match(production, /QIANTIE_BACKEND_PORT:-14000/);
  assert.doesNotMatch(production, /qiantie-test-|\.env\.test-docker/);
});

test('production Compose pins volume resource names without a project prefix', () => {
  for (const volume of ['mysql', 'objects', 'platform', 'redis']) {
    assert.match(
      production,
      new RegExp(`qiantie-production-${volume}:\\n\\s+name: qiantie-production-${volume}`),
    );
  }
});

test('production platform and backend consume the same explicit bridge secret', () => {
  assert.equal((production.match(/QIANTIE_BRIDGE_SECRET: \$\{QIANTIE_BRIDGE_SECRET\}/g) || []).length, 2);
  assert.match(production, /QIANTIE_TOKEN_SECRET: \$\{QIANTIE_TOKEN_SECRET\}/);
  assert.match(production, /QIANTIE_CREDENTIAL_ENCRYPTION_KEY: \$\{QIANTIE_CREDENTIAL_ENCRYPTION_KEY\}/);
});

test('production example contains no usable credentials and test stack remains separately named', () => {
  assert.match(example, /replace-with/);
  assert.doesNotMatch(example, /^[A-Z_]+=(?:[a-f0-9]{32,}|testpass)$/m);
  assert.match(testCompose, /qiantie-test-mysql/);
  assert.doesNotMatch(testCompose, /qiantie-production-mysql/);
});
