function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function resolveItemSettings(batch, item) {
  const base = { ...(batch?.settings || {}) };
  const override = item?.settingsOverride && typeof item.settingsOverride === 'object' ? item.settingsOverride : {};

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
  return base;
}

module.exports = { resolveItemSettings };
