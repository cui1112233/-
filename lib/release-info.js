const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_RELEASE_INFO_PATH = path.join(__dirname, '..', 'release-info.json');
const RELEASE_CHANNEL_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const RELEASE_VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const BUILD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,255}$/;
const GIT_REVISION_PATTERN = /^[0-9a-f]{40}$/i;
const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/i;
const RELEASE_CHANNELS = new Set(['development', 'candidate', 'review', 'stable', 'production']);
const REQUIRED_PROVENANCE_FIELDS = ['git_revision', 'image_digest'];
const IDENTITY_FIELDS = ['app_version', 'build_id', 'git_revision', 'image_digest', 'release_channel', 'compatibility_components'];
const ENV_FIELDS = {
  app_version: ['QIANTIE_RELEASE_VERSION', 'QIANTIE_RELEASE_APP_VERSION', 'QIANTIE_APP_VERSION', 'RELEASE_VERSION', 'APP_VERSION'],
  build_id: ['QIANTIE_RELEASE_BUILD_ID', 'RELEASE_BUILD_ID', 'BUILD_ID'],
  git_revision: ['QIANTIE_RELEASE_GIT_REVISION', 'QIANTIE_RELEASE_REVISION', 'QIANTIE_RELEASE_GIT_COMMIT', 'QIANTIE_GIT_REVISION', 'RELEASE_GIT_REVISION', 'GIT_REVISION', 'GIT_COMMIT', 'SOURCE_REVISION'],
  image_digest: ['QIANTIE_RELEASE_IMAGE_DIGEST', 'QIANTIE_RELEASE_DIGEST', 'QIANTIE_IMAGE_DIGEST', 'RELEASE_IMAGE_DIGEST', 'OCI_IMAGE_DIGEST', 'IMAGE_DIGEST'],
  release_channel: ['QIANTIE_RELEASE_CHANNEL', 'RELEASE_CHANNEL'],
  compatibility_components: ['QIANTIE_RELEASE_COMPATIBILITY_COMPONENTS', 'RELEASE_COMPATIBILITY_COMPONENTS']
};

// This is intentionally only the stable workbench contract. The complete
// internal V78_BUILD_INFO remains owned by routes/novel-panel.js.
const DEFAULT_WORKBENCH_COMPATIBILITY = {
  app_version: 'v78.3.0.2',
  build_id: 'v78.3.0.2-scene-event-canonical-timeline-20260818-r1',
  release_version: 'v78.3.0.2',
  workspace_schema_version: 40,
  release_channel: 'stable'
};
const DEFAULT_COMPATIBILITY_COMPONENTS = {
  workbench: DEFAULT_WORKBENCH_COMPATIBILITY
};

const SENSITIVE_KEY_PATTERN = /api[_-]?key|access[_-]?token|authorization|cookie|credential|database|dsn|password|private[_-]?key|secret|token|url/i;
const SENSITIVE_VALUE_PATTERNS = [
  /^bearer\s+\S+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /^(?:mysql|mariadb|postgres(?:ql)?|mongodb(?:\+srv)?|redis|rediss|amqp|amqps|mssql|sqlserver):\/\//i,
  /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i,
  /^[^:\s/]+:[^@\s/]+@(?:tcp|unix)\(/i,
  /(?:^|[?&;\s])(?:api[_-]?key|access[_-]?token|authorization|credential|password|private[_-]?key|secret|token)\s*[:=]\s*\S+/i,
  /^(?:sk|rk|pk|api|key)-[A-Za-z0-9_-]{16,}$/i,
  /^AKIA[0-9A-Z]{16}$/,
  /^AIza[0-9A-Za-z_-]{35}$/,
  /^gh[pousr]_[0-9A-Za-z]{20,}$/,
  /^eyJ[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+$/
];

function releaseError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function isSensitiveString(value) {
  return SENSITIVE_VALUE_PATTERNS.some(pattern => pattern.test(value.trim()));
}

function sanitizeValue(value) {
  if (typeof value === 'string') return isSensitiveString(value) ? undefined : value;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(sanitizeValue).filter(child => child !== undefined);
  if (!isPlainObject(value)) return undefined;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    const sanitized = sanitizeValue(child);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return result;
}

function sanitizeCompatibilityComponents(value) {
  if (!isPlainObject(value)) throw releaseError('RELEASE_INFO_INVALID', 'compatibility_components must be an object');
  const sanitized = sanitizeValue(value);
  if (!Object.prototype.hasOwnProperty.call(sanitized, 'workbench')) {
    sanitized.workbench = sanitizeValue(DEFAULT_COMPATIBILITY_COMPONENTS.workbench);
  }
  return sanitized;
}

function firstEnvironmentValue(env, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(env, name) && env[name] !== undefined) return env[name];
  }
  return undefined;
}

function parseCompatibilityEnvironment(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'object') return sanitizeCompatibilityComponents(value);
  try {
    return sanitizeCompatibilityComponents(JSON.parse(String(value)));
  } catch (error) {
    if (error?.code === 'RELEASE_INFO_INVALID') throw error;
    throw releaseError('RELEASE_INFO_INVALID', 'QIANTIE_RELEASE_COMPATIBILITY_COMPONENTS must be valid JSON');
  }
}

function readReleaseFile(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isPlainObject(parsed)) throw releaseError('RELEASE_INFO_INVALID', 'release metadata must be an object');
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    if (error?.code === 'RELEASE_INFO_INVALID') throw error;
    if (error instanceof SyntaxError) throw releaseError('RELEASE_INFO_INVALID_JSON', `release metadata is not valid JSON: ${filePath}`);
    throw releaseError('RELEASE_INFO_INVALID', `release metadata could not be read: ${filePath}`);
  }
}

function readEnvironmentMetadata(env) {
  const result = {};
  for (const [field, names] of Object.entries(ENV_FIELDS)) {
    const value = firstEnvironmentValue(env, names);
    if (value !== undefined) result[field] = field === 'compatibility_components' ? parseCompatibilityEnvironment(value) : value;
  }
  return result;
}

function validateReleaseText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw releaseError('RELEASE_INFO_INVALID', `${field} must be non-empty text`);
  return value.trim();
}

function validateIdentity({ app_version, build_id, git_revision, image_digest, release_channel, compatibility_components }) {
  const version = validateReleaseText(app_version, 'app_version');
  if (!RELEASE_VERSION_PATTERN.test(version)) throw releaseError('RELEASE_INFO_INVALID', 'app_version must be a semantic release version');
  const normalizedBuildId = validateReleaseText(build_id, 'build_id');
  if (!BUILD_ID_PATTERN.test(normalizedBuildId)) throw releaseError('RELEASE_INFO_INVALID', 'build_id contains unsupported characters');
  const revision = validateReleaseText(git_revision, 'git_revision');
  if (!GIT_REVISION_PATTERN.test(revision)) throw releaseError('RELEASE_INFO_INVALID', 'git_revision must be a full 40-character Git revision');
  if (/^0{40}$/i.test(revision)) throw releaseError('RELEASE_INFO_INVALID', 'git_revision must not be the all-zero revision');
  const digest = validateReleaseText(image_digest, 'image_digest');
  if (!IMAGE_DIGEST_PATTERN.test(digest)) throw releaseError('RELEASE_INFO_INVALID', 'image_digest must be an OCI sha256 digest');
  if (/^sha256:0{64}$/i.test(digest)) throw releaseError('RELEASE_INFO_INVALID', 'image_digest must not be the all-zero digest');
  const channel = validateReleaseText(release_channel, 'release_channel').toLowerCase();
  if (!RELEASE_CHANNEL_PATTERN.test(channel) || !RELEASE_CHANNELS.has(channel)) throw releaseError('RELEASE_INFO_INVALID', `unsupported release_channel: ${channel}`);
  const components = sanitizeCompatibilityComponents(compatibility_components);
  return {
    app_version: version,
    build_id: normalizedBuildId,
    git_revision: revision.toLowerCase(),
    image_digest: digest.toLowerCase(),
    release_channel: channel,
    compatibility_components: components
  };
}

function developmentIdentity(compatibilityComponents) {
  return {
    app_version: '0.0.0-development',
    build_id: 'development-unreleased',
    git_revision: null,
    image_digest: null,
    release_channel: 'development',
    compatibility_components: sanitizeCompatibilityComponents(compatibilityComponents || DEFAULT_COMPATIBILITY_COMPONENTS)
  };
}

function loadReleaseInfo(env = process.env, filePath = DEFAULT_RELEASE_INFO_PATH) {
  const sourceEnv = env && typeof env === 'object' ? env : {};
  const environmentFilePath = sourceEnv.QIANTIE_RELEASE_INFO_PATH || sourceEnv.QIANTIE_RELEASE_INFO_FILE || sourceEnv.RELEASE_INFO_PATH;
  const resolvedFilePath = filePath === DEFAULT_RELEASE_INFO_PATH && environmentFilePath ? environmentFilePath : filePath;
  const fileMetadata = readReleaseFile(resolvedFilePath);
  const environmentMetadata = readEnvironmentMetadata(sourceEnv);
  // The generated file is authoritative. Environment values fill deployment
  // gaps when a file is not mounted or is intentionally partial.
  const merged = { ...environmentMetadata, ...fileMetadata };
  const suppliedFields = IDENTITY_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(merged, field));
  const suppliedChannel = merged.release_channel === undefined ? undefined : String(merged.release_channel).trim().toLowerCase();

  if (suppliedFields.length === 0) return developmentIdentity();
  if (!suppliedChannel) throw releaseError('RELEASE_INFO_INVALID', 'release_channel is required when release metadata is supplied');
  if (suppliedChannel === 'development') {
    const development = developmentIdentity(merged.compatibility_components || DEFAULT_COMPATIBILITY_COMPONENTS);
    const hasProvenance = REQUIRED_PROVENANCE_FIELDS.some(field => merged[field] !== undefined && merged[field] !== null && merged[field] !== '');
    const hasCustomIdentity = (merged.app_version !== undefined && merged.app_version !== development.app_version)
      || (merged.build_id !== undefined && merged.build_id !== development.build_id);
    if (!hasCustomIdentity && !hasProvenance) return development;

    const missing = REQUIRED_PROVENANCE_FIELDS.filter(field => !merged[field]);
    if (missing.length) {
      throw releaseError('RELEASE_PROVENANCE_REQUIRED', `custom development metadata requires ${missing.join(' and ')}`);
    }
    return validateIdentity({
      ...merged,
      release_channel: 'development',
      compatibility_components: merged.compatibility_components || DEFAULT_COMPATIBILITY_COMPONENTS
    });
  }

  const missing = REQUIRED_PROVENANCE_FIELDS.filter(field => !merged[field]);
  if (missing.length) throw releaseError('RELEASE_PROVENANCE_REQUIRED', `release channel ${suppliedChannel} requires ${missing.join(' and ')}`);
  if (!merged.compatibility_components) merged.compatibility_components = DEFAULT_COMPATIBILITY_COMPONENTS;
  return validateIdentity(merged);
}

module.exports = {
  DEFAULT_COMPATIBILITY_COMPONENTS,
  DEFAULT_WORKBENCH_COMPATIBILITY,
  DEFAULT_RELEASE_INFO_PATH,
  IDENTITY_FIELDS,
  IMAGE_DIGEST_PATTERN,
  GIT_REVISION_PATTERN,
  loadReleaseInfo,
  sanitizeCompatibilityComponents,
  validateIdentity
};
