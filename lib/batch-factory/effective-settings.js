function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function resolveItemSettings(batch, item) {
  const base = { ...(batch?.settings || {}) };
  const override = item?.settingsOverride && typeof item.settingsOverride === 'object' ? item.settingsOverride : {};

  if (override.prefixMode && override.prefixMode !== 'inherit') base.prefixMode = override.prefixMode;

  const stringKeys = [
    'customPrefix', 'quality', 'restriction', 'negative',
    'constraintPrefixSource', 'constraintPrefixPresetId', 'constraintPrefixPersonalPromptId',
    'constraintQualitySource', 'constraintQualityPresetId', 'constraintQualityPersonalPromptId',
    'constraintRestrictionSource', 'constraintRestrictionPresetId', 'constraintRestrictionPersonalPromptId',
    'constraintNegativeSource', 'constraintNegativePresetId', 'constraintNegativePersonalPromptId'
  ];
  for (const key of stringKeys) {
    if (hasOwn(override, key)) base[key] = override[key];
  }

  const booleanKeys = [
    'injectCharacterPrompt', 'injectScenePrompt', 'injectPropPrompt',
    'constraintPrefixEnabled', 'constraintQualityEnabled', 'constraintRestrictionEnabled', 'constraintNegativeEnabled'
  ];
  for (const key of booleanKeys) {
    if (hasOwn(override, key) && typeof override[key] === 'boolean') base[key] = override[key];
  }
  return base;
}

module.exports = { resolveItemSettings };
