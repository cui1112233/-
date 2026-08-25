export const DEFAULT_SCRIPT_CONSTRAINTS = Object.freeze({
  enabled: false,
  // 新草稿必须由用户明确开启基础设定，避免子项显示为“已开”但总开关仍关闭的误导。
  baseSetup: { enabled: false, source: 'system', presetId: '', personalPromptId: '', body: '' },
  entityReferences: [],
  prefix: { enabled: false, source: 'system', presetId: '', personalPromptId: '', body: '' },
  quality: { enabled: false, source: 'system', presetId: '', personalPromptId: '', body: '' },
  restriction: { enabled: false, source: 'system', presetId: '', personalPromptId: '', body: '' },
  negative: { enabled: false, source: 'system', presetId: '', personalPromptId: '', body: '' }
});

const categories = ['baseSetup', 'prefix', 'quality', 'restriction', 'negative'];
const entityTypes = new Set(['character', 'scene']);
const referenceModes = new Set(['identity-lock', 'visual-lock', 'content-lock']);

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

function normalizeEntityReference(value) {
  if (!value || typeof value !== 'object') return null;
  const entityId = typeof value.entityId === 'string' ? value.entityId.trim().slice(0, 160) : '';
  const entityType = entityTypes.has(value.entityType) ? value.entityType : '';
  if (!entityId || !entityType) return null;
  const mode = referenceModes.has(value.mode) ? value.mode : (entityType === 'character' ? 'identity-lock' : 'visual-lock');
  const fields = Array.isArray(value.fields)
    ? [...new Set(value.fields.map(field => String(field || '').trim()).filter(Boolean))].slice(0, 12)
    : [];
  return { entityId, entityType, mode, fields };
}

function normalizeEntityReferences(value) {
  const refs = Array.isArray(value) ? value : [];
  const seen = new Set();
  const output = [];
  for (const item of refs) {
    const reference = normalizeEntityReference(item);
    if (!reference) continue;
    const key = `${reference.entityType}:${reference.entityId}:${reference.mode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(reference);
    if (output.length >= 24) break;
  }
  return output;
}

export function normalizeScriptConstraints(value) {
  const baseSetup = normalizeLayer(value?.baseSetup);
  // Older saved drafts predate the visible base-setup switch. Keep their
  // intended default: inject extracted characters and scenes unless disabled.
  if (typeof value?.baseSetup?.enabled !== 'boolean') baseSetup.enabled = true;
  return {
    enabled: value?.enabled === true,
    entityReferences: normalizeEntityReferences(value?.entityReferences),
    ...Object.fromEntries(categories.map(category => [category, normalizeLayer(value?.[category])])),
    baseSetup
  };
}

function entityLabel(data, fallback) {
  if (!data || typeof data !== 'object') return fallback;
  return data.角色名称 || data.场景名称 || data.名称 || data.name || data.人物 || data.场景 || fallback;
}

function resolvedReferenceText(references, extractInfo) {
  const characters = Array.isArray(extractInfo?.characters) ? extractInfo.characters : [];
  const scenes = Array.isArray(extractInfo?.scenes) ? extractInfo.scenes : [];
  const lines = [];

  for (const reference of references) {
    const source = reference.entityType === 'character' ? characters : scenes;
    const record = source.find(item => item?.id === reference.entityId);
    if (!record) continue;
    const data = record?.data && typeof record.data === 'object' ? record.data : record;
    const selectedData = reference.fields.length
      ? Object.fromEntries(reference.fields.filter(field => Object.prototype.hasOwnProperty.call(data || {}, field)).map(field => [field, data[field]]))
      : data;
    const typeLabel = reference.entityType === 'character' ? '人物' : '场景';
    const modeLabel = reference.mode === 'identity-lock' ? '身份一致性' : reference.mode === 'visual-lock' ? '视觉一致性' : '内容一致性';
    lines.push(`${typeLabel}「${entityLabel(data, reference.entityId)}」(${modeLabel})：${JSON.stringify(selectedData)}`);
  }

  return lines.length ? `【实体一致性引用】\n${lines.join('\n')}` : '';
}

export function constraintsForFormat(value, format, extractInfo) {
  if (format === 'shortdrama') return normalizeScriptConstraints(DEFAULT_SCRIPT_CONSTRAINTS);
  const normalized = normalizeScriptConstraints(value);
  const referenceText = resolvedReferenceText(normalized.entityReferences, extractInfo);
  if (!normalized.enabled || !referenceText) return normalized;
  return {
    ...normalized,
    restriction: {
      ...normalized.restriction,
      enabled: true,
      source: 'draft',
      body: [normalized.restriction.body.trim(), referenceText].filter(Boolean).join('\n\n')
    }
  };
}
