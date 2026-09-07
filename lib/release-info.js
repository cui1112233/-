const fs = require('node:fs');
const path = require('node:path');

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseEnvFile(filePath) {
  const result = {};
  if (!filePath || !fs.existsSync(filePath)) return result;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const index = text.indexOf('=');
    if (index <= 0) continue;
    const key = text.slice(0, index).trim();
    let value = text.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function readReleaseInfo({ env = process.env, rootDir = path.resolve(__dirname, '..') } = {}) {
  const releaseEnv = parseEnvFile(path.join(rootDir, 'RELEASE-ENV'));
  let gitSha = clean(env.QIANTIE_RELEASE_SHA) || clean(releaseEnv.QIANTIE_RELEASE_SHA);
  if (!gitSha) {
    const shaFile = path.join(rootDir, 'RELEASE-SHA');
    if (fs.existsSync(shaFile)) gitSha = clean(fs.readFileSync(shaFile, 'utf8'));
  }
  return {
    branch: 'v88',
    git_sha: gitSha,
    deployed_at: clean(env.QIANTIE_DEPLOYED_AT) || clean(releaseEnv.QIANTIE_DEPLOYED_AT),
    deploy_mode: clean(env.QIANTIE_DEPLOY_MODE) || clean(releaseEnv.QIANTIE_DEPLOY_MODE) || 'git-direct'
  };
}

module.exports = { readReleaseInfo };
