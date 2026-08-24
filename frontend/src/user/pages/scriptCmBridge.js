import { useEffect } from 'react';
import { registerCmBridge } from '../../shared/pet/cmBridge';
import { createEntity, entityData, normalizeExtractInfo } from './scriptEntities';
import { normalizeScriptConstraints } from './scriptConstraints';

const characterPatchKeys = ['名称', '角色名称', 'name', '身份', 'identity', '外形', 'appearance', '外观描述', '性格', 'personality', '关系', 'relation', '描述', 'description'];
const scenePatchKeys = ['名称', '场景名称', 'name', '场景', 'scene', '时段', 'time', '氛围', 'atmosphere', '氛围概述', '描述', 'description', '场景描述'];
const constraintCategories = new Set(['prefix', 'quality', 'restriction', 'negative']);

function allowedPatch(patch, keys) {
  const source = patch && typeof patch === 'object' ? patch : {};
  return Object.fromEntries(keys
    .filter(key => Object.prototype.hasOwnProperty.call(source, key))
    .map(key => [key, source[key]]));
}

function entityTypeForAction(type) {
  if (type.startsWith('character.')) return 'characters';
  if (type.startsWith('scene.')) return 'scenes';
  return '';
}

function entityLabel(record, fallback = '对象') {
  const data = entityData(record);
  if (!data || typeof data !== 'object') return String(data || fallback);
  return data.角色名称 || data.场景名称 || data.名称 || data.name || data.人物 || data.场景 || fallback;
}

function nextReference(constraints, action, extractInfo) {
  const entityId = action.targetId || String(action.payload?.entityId || '').trim();
  const explicitType = action.payload?.entityType || action.patch?.entityType;
  const inCharacters = extractInfo.characters.some(item => item.id === entityId);
  const inScenes = extractInfo.scenes.some(item => item.id === entityId);
  const entityType = explicitType === 'scene' || (!inCharacters && inScenes) ? 'scene' : 'character';
  if (!entityId || (entityType === 'character' ? !inCharacters : !inScenes)) {
    throw new Error('找不到要引用的人物或场景，请重新点选后再试。');
  }
  const mode = ['identity-lock', 'visual-lock', 'content-lock'].includes(action.payload?.mode || action.patch?.mode)
    ? (action.payload?.mode || action.patch?.mode)
    : entityType === 'character' ? 'identity-lock' : 'visual-lock';
  const fieldsSource = action.payload?.fields || action.patch?.fields;
  const fields = Array.isArray(fieldsSource) ? fieldsSource.map(value => String(value || '').trim()).filter(Boolean).slice(0, 12) : [];
  const current = normalizeScriptConstraints(constraints);
  const withoutDuplicate = current.entityReferences.filter(reference => !(reference.entityId === entityId && reference.mode === mode));
  return normalizeScriptConstraints({
    ...current,
    enabled: true,
    entityReferences: [...withoutDuplicate, { entityId, entityType, mode, fields }]
  });
}

export function useScriptCmBridge({
  form,
  extractInfo,
  setExtractInfo,
  output,
  updateOutputDraft,
  setPreviousOutput,
  setEditingOutput,
  constraints,
  setConstraints,
  setDraftConstraints,
  generationStage,
  invalidateEntityOutput
}) {
  useEffect(() => registerCmBridge({
    page: '剧本生成',
    pagePath: '/script',
    capabilities: [
      'character.update',
      'character.create',
      'character.setProtagonist',
      'scene.update',
      'scene.create',
      'script.replace',
      'constraint.bind',
      'constraint.update'
    ],
    getContext: () => ({
      page: '剧本生成',
      pagePath: '/script',
      summary: `当前阶段 ${generationStage}；人物 ${extractInfo.characters.length} 个；场景 ${extractInfo.scenes.length} 个；剧本${output.trim() ? '已生成' : '未生成'}。`,
      project: { format: form.getFieldValue('format') || '', mode: form.getFieldValue('mode') || '' }
    }),
    apply: async action => {
      const normalized = normalizeExtractInfo(extractInfo);
      const entityListType = entityTypeForAction(action.type);

      if (action.type === 'character.update' || action.type === 'scene.update') {
        const items = [...normalized[entityListType]];
        const index = items.findIndex(item => item.id === action.targetId);
        if (index < 0) throw new Error('找不到要修改的人物或场景，请重新点选后再试。');
        const patch = allowedPatch(action.patch, entityListType === 'characters' ? characterPatchKeys : scenePatchKeys);
        if (!Object.keys(patch).length) throw new Error('CM 没有提供可应用的人物/场景字段。');
        const currentData = entityData(items[index]);
        items[index] = { ...items[index], data: { ...(currentData && typeof currentData === 'object' ? currentData : {}), ...patch } };
        const next = { ...normalized, [entityListType]: items };
        setExtractInfo(next);
        invalidateEntityOutput(next);
        return { ok: true, message: `已更新「${entityLabel(items[index])}」。约束中的 ID 引用会继续指向它。` };
      }

      if (action.type === 'character.create' || action.type === 'scene.create') {
        const source = { ...(action.payload || {}), ...(action.patch || {}) };
        const data = allowedPatch(source, entityListType === 'characters' ? characterPatchKeys : scenePatchKeys);
        if (!Object.keys(data).length) throw new Error('CM 没有提供可创建的人物/场景内容。');
        const created = createEntity(data);
        const next = { ...normalized, [entityListType]: [...normalized[entityListType], created] };
        setExtractInfo(next);
        invalidateEntityOutput(next);
        return { ok: true, message: `已创建「${entityLabel(created)}」。` };
      }

      if (action.type === 'character.setProtagonist') {
        if (!normalized.characters.some(item => item.id === action.targetId)) throw new Error('找不到要设置的角色。');
        const enabled = action.patch?.enabled !== false;
        const protagonistIds = enabled
          ? [...new Set([...normalized.protagonistIds, action.targetId])]
          : normalized.protagonistIds.filter(id => id !== action.targetId);
        const next = { ...normalized, protagonistIds };
        setExtractInfo(next);
        invalidateEntityOutput(next);
        return { ok: true, message: enabled ? '已设为主角。' : '已取消主角标记。' };
      }

      if (action.type === 'script.replace') {
        const content = String(action.patch?.content || action.payload?.content || '').trim();
        if (!content) throw new Error('CM 没有提供可替换的剧本内容。');
        setPreviousOutput(output);
        updateOutputDraft(content);
        setEditingOutput(true);
        return { ok: true, message: '剧本修改已应用，可使用原有撤销按钮恢复。' };
      }

      if (action.type === 'constraint.bind') {
        const next = nextReference(constraints, action, normalized);
        setConstraints(next);
        setDraftConstraints(next);
        return { ok: true, message: '已加入实体一致性引用；后续生成会按实体 ID 读取最新设定。' };
      }

      if (action.type === 'constraint.update') {
        const category = String(action.payload?.category || action.patch?.category || '').trim();
        if (!constraintCategories.has(category)) throw new Error('不支持这个约束类别。');
        const current = normalizeScriptConstraints(constraints);
        const layerPatch = action.payload?.value && typeof action.payload.value === 'object'
          ? action.payload.value
          : action.patch?.value && typeof action.patch.value === 'object' ? action.patch.value : {};
        const next = normalizeScriptConstraints({
          ...current,
          enabled: action.patch?.enabled ?? action.payload?.enabled ?? true,
          [category]: { ...current[category], ...layerPatch }
        });
        setConstraints(next);
        setDraftConstraints(next);
        return { ok: true, message: '约束设置已更新。' };
      }

      throw new Error('剧本工作台暂不支持这个 CM 操作。');
    }
  }), [
    form,
    extractInfo,
    output,
    constraints,
    generationStage,
    setExtractInfo,
    updateOutputDraft,
    setPreviousOutput,
    setEditingOutput,
    setConstraints,
    setDraftConstraints,
    invalidateEntityOutput
  ]);
}

export function scriptEntitySelection(type, item) {
  if (!item?.id) return null;
  const entityType = type === 'characters' ? 'character' : 'scene';
  return {
    type: entityType,
    id: item.id,
    label: entityLabel(item, entityType === 'character' ? '未命名人物' : '未命名场景'),
    meta: { data: entityData(item) }
  };
}

export function removeEntityConstraintReferences(constraints, entityId) {
  const current = normalizeScriptConstraints(constraints);
  return normalizeScriptConstraints({
    ...current,
    entityReferences: current.entityReferences.filter(reference => reference.entityId !== entityId)
  });
}
