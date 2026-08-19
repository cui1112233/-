export const DEFAULT_SCRIPT_CONSTRAINTS = Object.freeze({
  enabled: false,
  baseSetup: { enabled: true, source: 'system', presetId: '', personalPromptId: '', body: '' },
  prefix: { enabled: false, source: 'system', presetId: '', personalPromptId: '', body: '' },
  quality: { enabled: false, source: 'system', presetId: '', personalPromptId: '', body: '' },
  restriction: { enabled: false, source: 'system', presetId: '', personalPromptId: '', body: '' },
  negative: { enabled: false, source: 'system', presetId: '', personalPromptId: '', body: '' }
});

const categories = ['baseSetup', 'prefix', 'quality', 'restriction', 'negative'];

function normalizeLayer(value) {
  const presetId = typeof value?.presetId === 'string' ? value.presetId : '';
  const personalPromptId = typeof value?.personalPromptId === 'string' ? value.personalPromptId : '';
  const body = typeof value?.body === 'string' ? value.body : (typeof value?.customText === 'string' ? value.customText : '');
  const source = ['system', 'personal', 'draft'].includes(value?.source)
    ? value.source
    : (personalPromptId ? 'personal' : (presetId ? 'system' : (body.trim() ? 'draft' : 'system')));
  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : Boolean(presetId || personalPromptId || body.trim()),
    source,
    presetId,
    personalPromptId,
    body
  };
}

export function normalizeScriptConstraints(value) {
  return {
    enabled: value?.enabled === true,
    ...Object.fromEntries(categories.map(category => [category, normalizeLayer(value?.[category])]))
  };
}

export function constraintsForFormat(value, format) {
  return format === 'shortdrama'
    ? normalizeScriptConstraints(DEFAULT_SCRIPT_CONSTRAINTS)
    : normalizeScriptConstraints(value);
}
