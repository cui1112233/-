const fs = require('node:fs');
const path = require('node:path');

const {
  readJsonOrMissing,
  writeJsonAtomic
} = require('../system-store');
const { assertValidUsername, isPlainObject } = require('./contracts');

const ASSET_TYPES = new Set(['character', 'scene', 'prop']);
const ASSET_VARIANTS = new Set(['source', 'main', 'thumb']);
const ASSET_TYPE_FOLDERS = { character: 'characters', scene: 'scenes', prop: 'props' };
const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
const IMAGE_SETTINGS_DEFAULTS = {
  base_url: '',
  model: '',
  generate_path: '/images/generations',
  edit_path: '/images/edits',
  size: '1536x1024',
  aspect_ratio: '16:9',
  supports_reference: true,
  timeout_seconds: 400,
  extra_json: {}
};

function safeAssetType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!ASSET_TYPES.has(normalized)) throw new Error('无效参考资产类型');
  return normalized;
}

function safeAssetId(value) {
  const normalized = String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '');
  if (!ASSET_ID_PATTERN.test(normalized)) throw new Error('无效参考资产ID');
  return normalized;
}

function safeAssetVariant(value) {
  const normalized = String(value || 'main').trim().toLowerCase();
  if (!ASSET_VARIANTS.has(normalized)) throw new Error('无效参考资产图片版本');
  return normalized;
}

function normalizeImageBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return `https://${raw}`;
  return raw;
}

function imageSettingsFromAccountConfig(config = {}) {
  const image = isPlainObject(config.image) ? config.image : {};
  return {
    ...IMAGE_SETTINGS_DEFAULTS,
    base_url: normalizeImageBaseUrl(image.baseUrl),
    model: String(image.model || '').trim(),
    api_key: String(image.apiKey || '').trim()
  };
}

function decodeDataUrl(dataUrl) {
  const raw = String(dataUrl || '').trim();
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/i.exec(raw);
  if (!match) throw new Error('图片数据必须是 base64 data URL');
  const mime = String(match[1] || 'image/png').toLowerCase();
  const payload = Buffer.from(String(match[2]).replace(/\s+/g, ''), 'base64');
  if (!payload.length) throw new Error('图片内容为空');
  return { payload, mime };
}

function imageExtForMime(mime) {
  const normalized = String(mime || '').toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return '.jpg';
  if (normalized.includes('webp')) return '.webp';
  return '.png';
}

function createNovelPanelPremiumStore({ usersDir } = {}) {
  if (typeof usersDir !== 'string' || !usersDir.trim()) throw new Error('usersDir is required');
  const resolvedUsersDir = path.resolve(usersDir);

  function panelDir(username) {
    const user = assertValidUsername(username);
    return path.join(resolvedUsersDir, user, 'novel-panel');
  }

  function imageSettingsPath(username) {
    return path.join(panelDir(username), 'image-settings.json');
  }

  function referenceAssetsDir(username, assetType) {
    const folder = ASSET_TYPE_FOLDERS[safeAssetType(assetType)];
    return path.join(panelDir(username), 'reference_assets', folder);
  }

  function readImageSettingsRaw(username) {
    const user = assertValidUsername(username);
    const value = { ...IMAGE_SETTINGS_DEFAULTS };
    let result;
    try {
      result = readJsonOrMissing(imageSettingsPath(user));
    } catch {
      return value;
    }
    if (result.found && isPlainObject(result.value)) Object.assign(value, result.value);
    value.supports_reference = value.supports_reference !== false;
    const parsed = Number.parseInt(value.timeout_seconds, 10);
    value.timeout_seconds = Number.isFinite(parsed) ? Math.max(30, Math.min(400, parsed)) : 400;
    if (!isPlainObject(value.extra_json)) value.extra_json = {};
    return value;
  }

  function publicImageSettings(username, value) {
    const raw = { ...(value || readImageSettingsRaw(username)) };
    const keyConfigured = Boolean(String(raw.api_key || '').trim());
    delete raw.api_key;
    raw.api_key_configured = keyConfigured;
    return raw;
  }

  function writeImageSettings(username, payload) {
    const user = assertValidUsername(username);
    const current = readImageSettingsRaw(user);
    const source = isPlainObject(payload) ? payload : {};
    for (const key of ['base_url', 'model', 'generate_path', 'edit_path', 'size', 'aspect_ratio']) {
      if (key in source) current[key] = String(source[key] || '').trim();
    }
    if (current.base_url) current.base_url = normalizeImageBaseUrl(current.base_url);
    if ('supports_reference' in source) current.supports_reference = Boolean(source.supports_reference);
    if ('timeout_seconds' in source) {
      const parsed = Number.parseInt(source.timeout_seconds, 10);
      if (Number.isFinite(parsed)) current.timeout_seconds = Math.max(30, Math.min(400, parsed));
    }
    if ('extra_json' in source) {
      let extra = source.extra_json;
      if (typeof extra === 'string') {
        try {
          extra = JSON.parse(extra || '{}');
        } catch {
          extra = {};
        }
      }
      current.extra_json = isPlainObject(extra) ? extra : {};
    }
    if (source.clear_api_key) {
      delete current.api_key;
    } else if (String(source.api_key || '').trim()) {
      current.api_key = String(source.api_key || '').trim();
    }
    writeJsonAtomic(imageSettingsPath(user), current);
    return publicImageSettings(user, current);
  }

  function assetFilePath(username, assetType, assetId, variant) {
    const safeVariant = safeAssetVariant(variant);
    const stem = `${safeAssetId(assetId)}_${safeVariant}`;
    const directory = referenceAssetsDir(username, assetType);
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
      const candidate = path.join(directory, `${stem}${ext}`);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  function writeReferenceAssetBytes(username, assetType, assetId, variant, payload, mime = 'image/png') {
    const user = assertValidUsername(username);
    const safeVariant = safeAssetVariant(variant);
    const safeId = safeAssetId(assetId);
    const directory = referenceAssetsDir(user, assetType);
    fs.mkdirSync(directory, { recursive: true });
    const stem = `${safeId}_${safeVariant}`;
    for (const entry of fs.readdirSync(directory)) {
      if (entry.startsWith(`${stem}.`)) {
        try {
          fs.unlinkSync(path.join(directory, entry));
        } catch (_) {
          // Best effort removal of the previous revision.
        }
      }
    }
    if (safeVariant === 'main') {
      const thumbStem = `${safeId}_thumb`;
      for (const entry of fs.readdirSync(directory)) {
        if (entry.startsWith(`${thumbStem}.`)) {
          try {
            fs.unlinkSync(path.join(directory, entry));
          } catch (_) {
            // Best effort removal of the stale thumbnail.
          }
        }
      }
    }
    const destination = path.join(directory, `${stem}${imageExtForMime(mime)}`);
    const tmp = path.join(directory, `${stem}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, destination);
    return destination;
  }

  function variantMetadata(username, assetType, assetId, variant) {
    const safeVariant = safeAssetVariant(variant);
    const filePath = assetFilePath(username, assetType, assetId, safeVariant);
    if (!filePath) {
      return { [`has_${safeVariant}_image`]: false, [`${safeVariant}_revision`]: '', [`${safeVariant}_updated_at`]: '' };
    }
    const stat = fs.statSync(filePath);
    return {
      [`has_${safeVariant}_image`]: true,
      [`${safeVariant}_revision`]: String(stat.mtimeMs).replace('.', ''),
      [`${safeVariant}_updated_at`]: stat.mtime.toISOString()
    };
  }

  function referenceAssetImageMetadata(username, assetType, assetId) {
    const user = assertValidUsername(username);
    const result = {};
    for (const variant of ASSET_VARIANTS) Object.assign(result, variantMetadata(user, assetType, assetId, variant));
    result.updated_at = result.main_updated_at || result.source_updated_at || result.thumb_updated_at || new Date().toISOString();
    return result;
  }

  function referenceAssetPublicUrl(assetType, assetId, variant, cacheBust = true) {
    const token = cacheBust ? `?_=${Date.now()}` : '';
    return `/api/novel-panel/reference-assets/file/${safeAssetType(assetType)}/${safeAssetId(assetId)}/${safeAssetVariant(variant)}${token}`;
  }

  return {
    assetFilePath,
    decodeDataUrl,
    imageSettingsPath,
    panelDir,
    publicImageSettings,
    readImageSettingsRaw,
    referenceAssetImageMetadata,
    referenceAssetPublicUrl,
    referenceAssetsDir,
    safeAssetId,
    safeAssetType,
    safeAssetVariant,
    writeImageSettings,
    writeReferenceAssetBytes
  };
}

module.exports = {
  ASSET_TYPES,
  ASSET_VARIANTS,
  IMAGE_SETTINGS_DEFAULTS,
  createNovelPanelPremiumStore,
  decodeDataUrl,
  imageSettingsFromAccountConfig,
  imageExtForMime,
  normalizeImageBaseUrl,
  safeAssetId,
  safeAssetType,
  safeAssetVariant
};
