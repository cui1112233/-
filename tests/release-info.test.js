const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const releaseInfoPath = path.join(__dirname, '..', 'lib', 'release-info');
const generatorPath = path.join(__dirname, '..', 'scripts', 'generate-release-info.js');
const identityKeys = ['app_version', 'build_id', 'git_revision', 'image_digest', 'release_channel', 'compatibility_components'];
const gitRevision = '0123456789abcdef0123456789abcdef01234567';
const imageDigest = `sha256:${'a'.repeat(64)}`;
const zeroGitRevision = '0'.repeat(40);
const zeroImageDigest = `sha256:${'0'.repeat(64)}`;

function fixtureDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-release-info-'));
}

function writeFixture(directory, value, name = 'release-info.json') {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
  return filePath;
}

function validMetadata(overrides = {}) {
  return {
    app_version: 'v88.0.0-candidate.1',
    build_id: 'v88-candidate-20260906-01',
    git_revision: gitRevision,
    image_digest: imageDigest,
    release_channel: 'candidate',
    compatibility_components: {
      workbench: {
        app_version: 'v78.3.0.2',
        build_id: 'v78.3.0.2-scene-event-canonical-timeline-20260818-r1',
        release_version: 'v78.3.0.2',
        workspace_schema_version: 40,
        release_channel: 'stable'
      }
    },
    ...overrides
  };
}

function withEnvironment(values, callback) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('loads a validated release file with the exact public identity shape', () => {
  const { loadReleaseInfo } = require(releaseInfoPath);
  const directory = fixtureDirectory();
  const filePath = writeFixture(directory, { ...validMetadata(), generated_at: '2026-09-06T00:00:00.000Z' });

  const result = loadReleaseInfo({}, filePath);

  assert.deepEqual(Object.keys(result), identityKeys);
  assert.deepEqual(result, validMetadata());
});

test('uses file metadata before deployment environment values and uses environment values when the file is absent', () => {
  const { loadReleaseInfo } = require(releaseInfoPath);
  const directory = fixtureDirectory();
  const filePath = writeFixture(directory, validMetadata());
  const fileResult = loadReleaseInfo({
    QIANTIE_RELEASE_VERSION: 'v99.0.0-candidate.9',
    QIANTIE_RELEASE_BUILD_ID: 'wrong-file-override',
    QIANTIE_RELEASE_GIT_REVISION: 'fedcba9876543210fedcba9876543210fedcba98',
    QIANTIE_RELEASE_IMAGE_DIGEST: `sha256:${'b'.repeat(64)}`,
    QIANTIE_RELEASE_CHANNEL: 'candidate'
  }, filePath);
  assert.equal(fileResult.app_version, 'v88.0.0-candidate.1');
  assert.equal(fileResult.build_id, 'v88-candidate-20260906-01');

  const envResult = loadReleaseInfo({
    QIANTIE_RELEASE_VERSION: 'v88.0.0-candidate.2',
    QIANTIE_RELEASE_BUILD_ID: 'v88-candidate-20260906-02',
    QIANTIE_RELEASE_GIT_REVISION: gitRevision,
    QIANTIE_RELEASE_IMAGE_DIGEST: imageDigest,
    QIANTIE_RELEASE_CHANNEL: 'candidate',
    QIANTIE_RELEASE_COMPATIBILITY_COMPONENTS: JSON.stringify(validMetadata().compatibility_components)
  }, path.join(directory, 'missing-release-info.json'));
  assert.equal(envResult.app_version, 'v88.0.0-candidate.2');
  assert.equal(envResult.build_id, 'v88-candidate-20260906-02');
  assert.equal(envResult.git_revision, gitRevision);
  assert.equal(envResult.image_digest, imageDigest);
  assert.equal(envResult.release_channel, 'candidate');
});

test('fails closed for candidate metadata without a full source revision or image digest', () => {
  const { loadReleaseInfo } = require(releaseInfoPath);
  const directory = fixtureDirectory();
  const filePath = writeFixture(directory, validMetadata({ git_revision: undefined, image_digest: undefined }));

  assert.throws(
    () => loadReleaseInfo({}, filePath),
    error => error?.code === 'RELEASE_PROVENANCE_REQUIRED'
      && /git_revision/.test(error.message)
      && /image_digest/.test(error.message)
  );
});

test('rejects explicit all-zero provenance through validation and release loading', () => {
  const { loadReleaseInfo, validateIdentity } = require(releaseInfoPath);
  const directory = fixtureDirectory();

  for (const releaseChannel of ['candidate', 'review', 'stable', 'production']) {
    const metadata = validMetadata({
      git_revision: zeroGitRevision,
      image_digest: zeroImageDigest,
      release_channel: releaseChannel
    });
    assert.throws(
      () => validateIdentity(metadata),
      error => error?.code === 'RELEASE_INFO_INVALID' && /zero/i.test(error.message),
      `${releaseChannel} direct validation must reject all-zero provenance`
    );
    const filePath = writeFixture(directory, metadata, `${releaseChannel}.json`);
    assert.throws(
      () => loadReleaseInfo({}, filePath),
      error => error?.code === 'RELEASE_INFO_INVALID' && /zero/i.test(error.message),
      `${releaseChannel} release loading must reject all-zero provenance`
    );
  }

  const developmentPath = writeFixture(directory, {
    app_version: 'v88.0.0-development.3',
    build_id: 'v88-local-zero-provenance',
    git_revision: zeroGitRevision,
    image_digest: zeroImageDigest,
    release_channel: 'development'
  }, 'development.json');
  assert.throws(
    () => loadReleaseInfo({}, developmentPath),
    error => error?.code === 'RELEASE_INFO_INVALID' && /zero/i.test(error.message)
  );
});

test('rejects malformed JSON and invalid release identity fields', () => {
  const { loadReleaseInfo } = require(releaseInfoPath);
  const directory = fixtureDirectory();
  const malformedPath = path.join(directory, 'malformed.json');
  fs.writeFileSync(malformedPath, '{not-json', 'utf8');
  assert.throws(() => loadReleaseInfo({}, malformedPath), error => error?.code === 'RELEASE_INFO_INVALID_JSON');

  const invalidPath = writeFixture(directory, validMetadata({
    app_version: 'not-a-release',
    build_id: ' ',
    git_revision: 'short',
    image_digest: 'sha256:bad'
  }));
  assert.throws(() => loadReleaseInfo({}, invalidPath), error => error?.code === 'RELEASE_INFO_INVALID');
});

test('returns a visibly non-release development identity without guessing V88', () => {
  const { loadReleaseInfo } = require(releaseInfoPath);
  const result = withEnvironment({
    QIANTIE_RELEASE_INFO_PATH: path.join(fixtureDirectory(), 'does-not-exist.json'),
    QIANTIE_RELEASE_VERSION: undefined,
    QIANTIE_RELEASE_BUILD_ID: undefined,
    QIANTIE_RELEASE_GIT_REVISION: undefined,
    QIANTIE_RELEASE_IMAGE_DIGEST: undefined,
    QIANTIE_RELEASE_CHANNEL: undefined,
    QIANTIE_RELEASE_COMPATIBILITY_COMPONENTS: undefined
  }, () => loadReleaseInfo(process.env));

  assert.equal(result.release_channel, 'development');
  assert.match(result.app_version, /development/i);
  assert.match(result.build_id, /development|unreleased/i);
  assert.doesNotMatch(result.app_version, /^v88(?:\.|$)/i);
  assert.equal(result.git_revision, null);
  assert.equal(result.image_digest, null);
});

test('rejects custom development identity unless complete genuine provenance is supplied', () => {
  const { loadReleaseInfo } = require(releaseInfoPath);
  const directory = fixtureDirectory();
  const missingProvenancePath = writeFixture(directory, {
    app_version: 'v88.0.0-development.1',
    build_id: 'v88-local-custom',
    release_channel: 'development'
  });

  assert.throws(
    () => loadReleaseInfo({}, missingProvenancePath),
    error => error?.code === 'RELEASE_PROVENANCE_REQUIRED'
      && /git_revision/.test(error.message)
      && /image_digest/.test(error.message)
  );

  const completeProvenancePath = writeFixture(directory, {
    app_version: 'v88.0.0-development.1',
    build_id: 'v88-local-custom',
    git_revision: gitRevision,
    image_digest: imageDigest,
    release_channel: 'development'
  }, 'complete-development.json');
  const result = loadReleaseInfo({}, completeProvenancePath);

  assert.equal(result.app_version, 'v88.0.0-development.1');
  assert.equal(result.build_id, 'v88-local-custom');
  assert.equal(result.git_revision, gitRevision);
  assert.equal(result.image_digest, imageDigest);
});

test('redacts secrets, database URLs, tokens, and provider credentials from compatibility components', () => {
  const { loadReleaseInfo } = require(releaseInfoPath);
  const directory = fixtureDirectory();
  const filePath = writeFixture(directory, validMetadata({
    compatibility_components: {
      workbench: validMetadata().compatibility_components.workbench,
      provider: {
        api_key: 'secret-api-key',
        database_url: 'mysql://user:password@example.invalid/db',
        access_token: 'secret-token',
        provider_credentials: 'secret-credentials',
        mode: 'remote'
      }
    }
  }));

  const result = loadReleaseInfo({}, filePath);

  assert.equal(result.compatibility_components.provider.mode, 'remote');
  assert.equal('api_key' in result.compatibility_components.provider, false);
  assert.equal('database_url' in result.compatibility_components.provider, false);
  assert.equal('access_token' in result.compatibility_components.provider, false);
  assert.equal('provider_credentials' in result.compatibility_components.provider, false);
  assert.doesNotMatch(JSON.stringify(result), /secret-api-key|mysql:\/\/|secret-token|secret-credentials/);
});

test('redacts credential-shaped values under neutral keys and inside nested arrays', () => {
  const { loadReleaseInfo } = require(releaseInfoPath);
  const directory = fixtureDirectory();
  const privateKey = '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----';
  const filePath = writeFixture(directory, validMetadata({
    compatibility_components: {
      workbench: validMetadata().compatibility_components.workbench,
      provider: {
        endpoint: 'mysql://user:password@db.example.invalid/platform',
        value: 'Bearer neutral-key-token-value',
        signing_material: privateKey,
        modes: [
          'remote',
          ['safe-fallback', 'sk-neutralkeycredential1234567890'],
          { label: 'primary', value: 'postgresql://user:password@db.example.invalid/platform' }
        ],
        harmless_endpoint: 'https://api.example.invalid/v1',
        harmless_values: ['stable', 'v78-compatible', 40]
      }
    }
  }));

  const result = loadReleaseInfo({}, filePath);
  const serialized = JSON.stringify(result);

  assert.equal('endpoint' in result.compatibility_components.provider, false);
  assert.equal('value' in result.compatibility_components.provider, false);
  assert.equal('signing_material' in result.compatibility_components.provider, false);
  assert.deepEqual(result.compatibility_components.provider.modes, [
    'remote',
    ['safe-fallback'],
    { label: 'primary' }
  ]);
  assert.equal(result.compatibility_components.provider.harmless_endpoint, 'https://api.example.invalid/v1');
  assert.deepEqual(result.compatibility_components.provider.harmless_values, ['stable', 'v78-compatible', 40]);
  assert.doesNotMatch(serialized, /mysql:\/\/|postgresql:\/\/|Bearer neutral|BEGIN PRIVATE KEY|sk-neutralkeycredential/);
});

test('generates sorted release metadata and rejects incomplete candidate output', () => {
  const directory = fixtureDirectory();
  const outputPath = path.join(directory, 'generated-release-info.json');
  execFileSync(process.execPath, [
    generatorPath,
    '--version', 'v88.0.0-candidate.3',
    '--build-id', 'v88-candidate-20260906-03',
    '--git-revision', gitRevision,
    '--image-digest', imageDigest,
    '--channel', 'candidate',
    '--output', outputPath
  ], { encoding: 'utf8' });
  const generated = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.deepEqual(Object.keys(generated), [...Object.keys(generated)].sort());
  assert.deepEqual({ ...generated, generated_at: undefined }, {
    ...validMetadata({
      app_version: 'v88.0.0-candidate.3',
      build_id: 'v88-candidate-20260906-03'
    }),
      generated_at: undefined
  });
  assert.equal('generated_at' in generated, false);

  const evidencePath = path.join(directory, 'generated-release-evidence.json');
  execFileSync(process.execPath, [
    generatorPath,
    '--version', 'v88.0.0-candidate.3',
    '--build-id', 'v88-candidate-20260906-03',
    '--git-revision', gitRevision,
    '--image-digest', imageDigest,
    '--channel', 'candidate',
    '--evidence',
    '--output', evidencePath
  ], { encoding: 'utf8' });
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.match(evidence.generated_at, /^20\d\d-\d\d-\d\dT/);
  assert.deepEqual(require(releaseInfoPath).loadReleaseInfo({}, evidencePath), generated);

  const missing = require('node:child_process').spawnSync(process.execPath, [
    generatorPath,
    '--version', 'v88.0.0-candidate.4',
    '--build-id', 'v88-candidate-20260906-04',
    '--channel', 'candidate',
    '--output', path.join(directory, 'missing.json')
  ], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /git[_-]revision|image[_-]digest/i);

  const customDevelopment = require('node:child_process').spawnSync(process.execPath, [
    generatorPath,
    '--version', 'v88.0.0-development.2',
    '--build-id', 'v88-local-generator',
    '--channel', 'development',
    '--output', path.join(directory, 'custom-development.json')
  ], { encoding: 'utf8' });
  assert.notEqual(customDevelopment.status, 0);
  assert.match(customDevelopment.stderr, /git[_-]revision|image[_-]digest/i);

  const canonicalDevelopmentPath = path.join(directory, 'canonical-development.json');
  execFileSync(process.execPath, [
    generatorPath,
    '--channel', 'development',
    '--output', canonicalDevelopmentPath
  ], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(fs.readFileSync(canonicalDevelopmentPath, 'utf8')), {
    app_version: '0.0.0-development',
    build_id: 'development-unreleased',
    compatibility_components: validMetadata().compatibility_components,
    git_revision: null,
    image_digest: null,
    release_channel: 'development'
  });
});

test('generator rejects explicit all-zero release and custom development provenance', () => {
  const directory = fixtureDirectory();

  for (const releaseChannel of ['candidate', 'development']) {
    const generated = require('node:child_process').spawnSync(process.execPath, [
      generatorPath,
      '--version', releaseChannel === 'candidate' ? 'v88.0.0-candidate.5' : 'v88.0.0-development.4',
      '--build-id', `v88-${releaseChannel}-zero-provenance`,
      '--git-revision', zeroGitRevision,
      '--image-digest', zeroImageDigest,
      '--channel', releaseChannel,
      '--output', path.join(directory, `${releaseChannel}.json`)
    ], { encoding: 'utf8' });

    assert.notEqual(generated.status, 0, `${releaseChannel} generation must fail`);
    assert.match(generated.stderr, /zero/i);
    assert.equal(fs.existsSync(path.join(directory, `${releaseChannel}.json`)), false);
  }
});

test('top-level build-info exposes the fixture release while novel-panel diagnostics keep V78 workbench compatibility explicit', async () => {
  const directory = fixtureDirectory();
  const filePath = writeFixture(directory, validMetadata());
  const previousPath = process.env.QIANTIE_RELEASE_INFO_PATH;
  process.env.QIANTIE_RELEASE_INFO_PATH = filePath;
  const { createAccountStore } = require('../lib/account-store');
  const { createApp } = require('../app');
  const accountStore = createAccountStore({ systemDir: path.join(directory, 'system') });
  const tokenMap = new Map([['test-token', { username: 'choushiyiguai' }]]);
  const app = createApp({ accountStore, tokenMap, sessionsPath: path.join(directory, 'sessions.json') });
  const server = require('node:http').createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const buildInfo = await fetch(`http://127.0.0.1:${port}/api/build-info`).then(response => response.json());
    assert.deepEqual(buildInfo, validMetadata());
    assert.equal(buildInfo.git_revision, gitRevision);
    assert.equal(buildInfo.image_digest, imageDigest);
    assert.notEqual(buildInfo.app_version, 'v78.3.0.3');

    const diagnostics = await fetch(`http://127.0.0.1:${port}/api/novel-panel/diagnostics/self-check`, {
      headers: { Authorization: 'Bearer test-token' }
    }).then(response => response.json());
    assert.deepEqual(diagnostics.platform_release, buildInfo);
    assert.equal(diagnostics.compatibility_components.workbench.app_version, 'v78.3.0.2');
    assert.equal(diagnostics.build.app_version, 'v78.3.0.2');
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousPath === undefined) delete process.env.QIANTIE_RELEASE_INFO_PATH;
    else process.env.QIANTIE_RELEASE_INFO_PATH = previousPath;
  }
});
