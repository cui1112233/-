function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

const OVERRIDE_KEYS = Object.freeze([
  'aspectRatio',
  'prefixMode',
  'customPrefix',
  'prefixEnabled',
  'injectCharacterPrompt',
  'injectScenePrompt',
  'injectPropPrompt',
  'quality',
  'qualityEnabled',
  'restriction',
  'restrictionEnabled',
  'negative',
  'negativeEnabled',
  'subtitlePolicy'
]);

function applyOverride(base, override) {
  const next = { ...(base || {}) };
  if (!override || typeof override !== 'object' || Array.isArray(override)) return next;
  for (const key of OVERRIDE_KEYS) {
    if (!hasOwn(override, key)) continue;
    if (key === 'prefixMode' && override[key] === 'inherit') continue;
    next[key] = override[key];
  }
  return next;
}

function resolveItemSettings(batch, item) {
  return applyOverride(batch?.settings || {}, item?.settingsOverride);
}

function resolveVideoSettings(batch, item, videoId) {
  const book = resolveItemSettings(batch, item);
  const key = String(videoId ?? '');
  const videoOverride = item?.videoSettingsOverrides && typeof item.videoSettingsOverrides === 'object'
    ? item.videoSettingsOverrides[key]
    : null;
  return applyOverride(book, videoOverride);
}

module.exports = { resolveItemSettings, resolveVideoSettings, OVERRIDE_KEYS, applyOverride, hasOwn };
