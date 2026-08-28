function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function resolveItemSettings(batch, item) {
  const base = { ...(batch?.settings || {}) };
  const override = item?.settingsOverride && typeof item.settingsOverride === 'object' ? item.settingsOverride : {};

  for (const key of ['scriptPromptPresetId', 'assetPromptPresetId', 'style', 'synopsis']) {
    if (hasOwn(override, key) && String(override[key] || '').trim()) base[key] = String(override[key]).trim();
  }

  if (override.aspectRatio === '9:16' || override.aspectRatio === '16:9') base.aspectRatio = override.aspectRatio;
  if (typeof override.fixedSingleVideo === 'boolean') base.fixedSingleVideo = override.fixedSingleVideo;

  if (override.prefixMode && override.prefixMode !== 'inherit') base.prefixMode = override.prefixMode;
  if (override.prefixMode === 'manual') {
    base.customPrefix = hasOwn(override, 'customPrefix') ? String(override.customPrefix || '').trim() : '';
  } else if (override.prefixMode !== 'inherit' && hasOwn(override, 'customPrefix') && String(override.customPrefix || '').trim()) {
    base.customPrefix = String(override.customPrefix || '').trim();
  }

  for (const key of ['quality', 'restriction', 'negative']) {
    if (hasOwn(override, key) && String(override[key] || '').trim()) base[key] = String(override[key]).trim();
  }

  for (const key of ['injectCharacterPrompt', 'injectScenePrompt', 'injectPropPrompt']) {
    if (hasOwn(override, key) && typeof override[key] === 'boolean') base[key] = override[key];
  }

  if (override.subtitlePolicy === 'allow' || override.subtitlePolicy === 'forbid-auto-dialogue-subtitle') {
    base.subtitlePolicy = override.subtitlePolicy;
  }

  base.fixedSingleVideo = base.fixedSingleVideo === true;
  base.exactDuration = base.fixedSingleVideo ? Number(base.maxVideoDuration || 0) || null : null;
  return base;
}

module.exports = { resolveItemSettings };