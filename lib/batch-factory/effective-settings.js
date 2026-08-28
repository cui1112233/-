function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

const BOOK_OVERRIDE_KEYS = Object.freeze([
  'productionMode',
  'productionLineCount',
  'hookReviewMode',
  'scriptPromptPresetId',
  'assetPromptPresetId',
  'videoModelId',
  'videoModelVersionId',
  'videoModelName',
  'videoModelMaxDuration',
  'maxVideoDuration',
  'fixedSingleVideo',
  'exactDuration',
  'aspectRatio',
  'style',
  'synopsis',
  'subtitlePolicy',
  'prefixMode',
  'customPrefix',
  'quality',
  'restriction',
  'negative',
  'injectCharacterPrompt',
  'injectScenePrompt',
  'injectPropPrompt'
]);

const VIDEO_OVERRIDE_KEYS = Object.freeze([
  'aspectRatio',
  'subtitlePolicy',
  'prefixMode',
  'customPrefix',
  'quality',
  'restriction',
  'negative',
  'injectCharacterPrompt',
  'injectScenePrompt',
  'injectPropPrompt'
]);

function applyOverride(base, override, allowedKeys) {
  const next = { ...base };
  if (!override || typeof override !== 'object' || Array.isArray(override)) return next;
  for (const key of allowedKeys) {
    if (!hasOwn(override, key)) continue;
    const value = override[key];
    if (value === undefined) continue;
    next[key] = value;
  }
  return next;
}

function resolveItemSettings(batch, item) {
  const base = {
    productionMode: batch?.settings?.productionMode || batch?.mode || 'original',
    productionLineCount: 10,
    hookReviewMode: 'auto',
    ...(batch?.settings || {})
  };
  return applyOverride(base, item?.settingsOverride, BOOK_OVERRIDE_KEYS);
}

function resolveVideoSettings(batch, item, video) {
  return applyOverride(resolveItemSettings(batch, item), video?.settingsOverride, VIDEO_OVERRIDE_KEYS);
}

module.exports = {
  resolveItemSettings,
  resolveVideoSettings,
  BOOK_OVERRIDE_KEYS,
  VIDEO_OVERRIDE_KEYS
};
