function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

const DIRECT_OVERRIDE_KEYS = Object.freeze([
  'scriptPromptPresetId',
  'assetPromptPresetId',
  'aspectRatio',
  'style',
  'synopsis',
  'subtitlePolicy'
]);

function resolveItemSettings(batch, item) {
  const base = { ...(batch?.settings || {}) };
  const override = item?.settingsOverride && typeof item.settingsOverride === 'object' ? item.settingsOverride : {};

  // Batch Factory is an independent production pipeline. A book inherits the
  // batch defaults, but can override its own director/prompt settings without
  // changing any other book in the batch.
  for (const key of DIRECT_OVERRIDE_KEYS) {
    if (!hasOwn(override, key)) continue;
    const value = override[key];
    if (typeof value === 'string' && value.trim()) base[key] = value.trim();
  }

  if (override.prefixMode && override.prefixMode !== 'inherit') base.prefixMode = override.prefixMode;
  if (override.prefixMode === 'manual' || (override.prefixMode === 'inherit' && hasOwn(override, 'customPrefix'))) {
    if (hasOwn(override, 'customPrefix')) base.customPrefix = override.customPrefix;
  } else if (hasOwn(override, 'customPrefix') && String(override.customPrefix || '').trim()) {
    base.customPrefix = override.customPrefix;
  }

  for (const key of ['quality', 'restriction', 'negative']) {
    if (hasOwn(override, key) && String(override[key] || '').trim()) base[key] = override[key];
  }
  for (const key of ['injectCharacterPrompt', 'injectScenePrompt', 'injectPropPrompt']) {
    if (hasOwn(override, key) && typeof override[key] === 'boolean') base[key] = override[key];
  }

  if (hasOwn(override, 'fixedSingleVideo') && typeof override.fixedSingleVideo === 'boolean') {
    base.fixedSingleVideo = override.fixedSingleVideo;
    base.exactDuration = override.fixedSingleVideo
      ? Number(override.exactDuration || base.maxVideoDuration || 0) || null
      : null;
  }

  return base;
}

module.exports = { resolveItemSettings, DIRECT_OVERRIDE_KEYS };
