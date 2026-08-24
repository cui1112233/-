export const DEFAULT_SCRIPT_CONSTRAINTS = Object.freeze({
  enabled: false,
  // 新草稿必须由用户明确开启基础设定，避免子项显示为“已开”但总开关仍关闭的误导。
  baseSetup: { enabled: false, source: 'system', presetId: '', personalPromptId: '', body: '' },
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
  const baseSetup = normalizeLayer(value?.baseSetup);
  // Older saved drafts predate the visible base-setup switch. Keep their
  // intended default: inject extracted characters and scenes unless disabled.
  if (typeof value?.baseSetup?.enabled !== 'boolean') baseSetup.enabled = true;
  return {
    enabled: value?.enabled === true,
    ...Object.fromEntries(categories.map(category => [category, normalizeLayer(value?.[category])])),
    baseSetup
  };
}

export function constraintsForFormat(value, format) {
  return format === 'shortdrama'
    ? normalizeScriptConstraints(DEFAULT_SCRIPT_CONSTRAINTS)
    : normalizeScriptConstraints(value);
}
