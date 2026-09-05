#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_COMPATIBILITY_COMPONENTS,
  loadReleaseInfo,
  sanitizeCompatibilityComponents
} = require('../lib/release-info');

function usageError(message) {
  const error = new Error(message);
  error.code = 'USAGE';
  return error;
}

function parseArgs(argv) {
  const options = { evidence: false };
  const valueFlags = new Map([
    ['--version', 'version'],
    ['--build-id', 'buildId'],
    ['--git-revision', 'gitRevision'],
    ['--image-digest', 'imageDigest'],
    ['--channel', 'channel'],
    ['--output', 'output'],
    ['--output-path', 'output'],
    ['--compatibility-components', 'compatibilityComponents']
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--evidence') {
      options.evidence = true;
      continue;
    }
    const key = valueFlags.get(flag);
    if (!key) throw usageError(`Unknown argument: ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw usageError(`${flag} requires a value`);
    options[key] = value;
  }
  if (!options.output) throw usageError('--output is required');
  return options;
}

function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedValue(value[key])]));
  }
  return value;
}

function generate(options) {
  let compatibilityComponents = DEFAULT_COMPATIBILITY_COMPONENTS;
  if (options.compatibilityComponents) {
    try {
      compatibilityComponents = sanitizeCompatibilityComponents(JSON.parse(options.compatibilityComponents));
    } catch (error) {
      if (error?.code === 'RELEASE_INFO_INVALID') throw error;
      throw usageError('--compatibility-components must be valid JSON');
    }
  }
  const input = {
    QIANTIE_RELEASE_VERSION: options.version,
    QIANTIE_RELEASE_BUILD_ID: options.buildId,
    QIANTIE_RELEASE_GIT_REVISION: options.gitRevision,
    QIANTIE_RELEASE_IMAGE_DIGEST: options.imageDigest,
    QIANTIE_RELEASE_CHANNEL: options.channel || 'development',
    QIANTIE_RELEASE_COMPATIBILITY_COMPONENTS: JSON.stringify(compatibilityComponents)
  };
  const identity = loadReleaseInfo(input, path.join(path.dirname(options.output), '.no-release-info.json'));
  const output = options.evidence ? { ...identity, generated_at: new Date().toISOString() } : identity;
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(sortedValue(output), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return identity;
}

try {
  const options = parseArgs(process.argv.slice(2));
  generate(options);
  process.stdout.write(`Wrote release metadata to ${options.output}\n`);
} catch (error) {
  process.stderr.write(`generate-release-info: ${error.message}\n`);
  process.exitCode = error.code === 'USAGE' ? 2 : 1;
}
