import { Alert, Button, Divider, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Space, Switch, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { listAvailableModels } from '../../../shared/api/modelCatalog';
import { listSystemPresetCatalog, saveBookOverride } from '../../../shared/api/batchFactoryV11';
import { deleteScriptConstraintPrompt, getConstraintPresetTexts, listScriptConstraintPrompts, saveScriptConstraintPrompt, updateScriptConstraintPrompt } from '../../../shared/api/generation';

const BOOK_OVERRIDE_FIELDS = ['textModelId', 'imageModelId', 'videoModelId', 'videoProvider', 'aspectRatio', 'productionMode', 'maxVideoDuration', 'fixedSingleVideo', 'fixedVideoDuration', 'aiPromptConfig'];
const ENGINE_OVERRIDE_FIELDS = ['textModelId', 'imageModelId', 'videoModelId', 'videoProvider', 'aspectRatio', 'productionMode'];
const VIDEO_SETTING_FIELDS = ['maxVideoDuration', 'fixedSingleVideo', 'fixedVideoDuration'];
export const AI_REGION_KEYS = new Map([
  ['assets', 'assets'],
  ['constraints', 'constraints'],
  ['video', 'video'],
  ['visual', 'visual']
]);
const REGION_LABELS = {
  engine: '引擎配置',
  assets: '资产设置',
  constraints: '约束设置',
  video: '视频设置',
  visual: '画面设置'
};
const VIDEO_PROVIDER_OPTIONS = [
  { value: 'personal_api', label: '个人中心 API' },
  { value: 'doubao_local_executor', label: '豆包本地执行器' },
  { value: 'autodl_comfyui', label: 'AutoDL ComfyUI' }
];
const CONSTRAINT_LAYERS = [
  ['baseSetup', '基础设定（人物 / 场景）'],
  ['prefix', '画面前缀词'],
  ['quality', '画质约束'],
  ['restriction', '画面限制'],
  ['negative', '负面提示词']
];
const EDITABLE_CONSTRAINT_LAYERS = CONSTRAINT_LAYERS.filter(([category]) => category !== 'baseSetup');
const ASSET_SLOTS = [
  ['extraction', '人物场景提取', 'script.extract'],
  ['character', '人物提示词', 'batch.character-meta'],
  ['scene', '场景提示词', 'batch.scene-meta'],
  ['prop', '道具提示词', 'batch.prop-meta']
];

function equal(left, right) { return JSON.stringify(left ?? null) === JSON.stringify(right ?? null); }
function mergePromptConfig(base, override) {
  const merged = { ...(base || {}), ...(override || {}) };
  for (const key of ['assets', 'constraints', 'video', 'visual']) {
    merged[key] = { ...(base?.[key] || {}), ...(override?.[key] || {}) };
  }
  return merged;
}
function effectiveValues(batchPatch, bookPatch) {
  return { ...(batchPatch || {}), ...(bookPatch || {}), aiPromptConfig: mergePromptConfig(batchPatch?.aiPromptConfig, bookPatch?.aiPromptConfig) };
}
function selectedMeta(catalog, id) {
  const preset = catalog.find(item => item.id === id);
  return preset ? { presetId: preset.id, presetName: preset.name, presetSlot: preset.slot, presetVersion: preset.version, constraintCategory: preset.constraintCategory || '' } : { presetId: '' };
}
function optionFor(preset) { return { value: preset.id, label: `${preset.name || preset.id} · v${preset.version || 1}` }; }

function normalizeConstraintLayer(value, fallback = {}) {
  const source = ['system', 'personal', 'draft'].includes(value?.source) ? value.source : (fallback?.personalPromptId ? 'personal' : 'system');
  return {
    enabled: value?.enabled === true,
    source,
    presetId: String(value?.presetId || fallback?.presetId || ''),
    presetName: String(value?.presetName || fallback?.presetName || ''),
    presetSlot: String(value?.presetSlot || fallback?.presetSlot || ''),
    presetVersion: Number(value?.presetVersion || fallback?.presetVersion || 0),
    personalPromptId: String(value?.personalPromptId || fallback?.personalPromptId || ''),
    body: String(value?.body || fallback?.body || '')
  };
}

function normalizeConstraintRules(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const selections = Array.isArray(raw.selections) ? raw.selections : [];
  const enabledCategories = Array.isArray(raw.enabledCategories) ? raw.enabledCategories : [];
  const layers = Object.fromEntries(EDITABLE_CONSTRAINT_LAYERS.map(([category]) => {
    const fallback = selections.find(item => item?.constraintCategory === category) || {};
    const layer = normalizeConstraintLayer(raw[category], fallback);
    if (enabledCategories.includes(category) && raw[category]?.enabled === undefined) layer.enabled = true;
    return [category, layer];
  }));
  return {
    ...raw,
    enabled: raw.enabled === true,
    baseSetup: { enabled: raw.baseSetup?.enabled === true },
    ...layers
  };
}

function withDirectorConstraintSelections(value) {
  const rules = normalizeConstraintRules(value);
  const enabledCategories = EDITABLE_CONSTRAINT_LAYERS.filter(([category]) => rules[category].enabled).map(([category]) => category);
  const selections = EDITABLE_CONSTRAINT_LAYERS.flatMap(([category]) => {
    const layer = rules[category];
    if (!layer.enabled || !layer.body.trim()) return [];
    return [{
      presetId: layer.presetId,
      presetName: layer.presetName,
      presetSlot: layer.presetSlot,
      presetVersion: layer.presetVersion,
      personalPromptId: layer.personalPromptId,
      body: layer.body.trim(),
      constraintCategory: category
    }];
  });
  return { ...rules, enabledCategories, selections };
}

export function buildBookOverridePatch(inherited, edited) {
  return Object.fromEntries(BOOK_OVERRIDE_FIELDS
    .filter(key => !equal(inherited?.[key], edited?.[key]))
    .map(key => [key, edited[key]]));
}

function buildRestoreKeys(inherited, edited, currentPatch) {
  return BOOK_OVERRIDE_FIELDS.filter(key => Object.hasOwn(currentPatch || {}, key) && equal(inherited?.[key], edited?.[key]));
}

export function buildBookRegionUpdate(inherited, bookPatch, region, edited) {
  const patch = {};
  const restoreKeys = [];
  if (region === 'engine') {
    for (const key of ENGINE_OVERRIDE_FIELDS) {
      if (!equal(inherited?.[key], edited?.[key])) patch[key] = edited?.[key];
      else if (Object.hasOwn(bookPatch || {}, key)) restoreKeys.push(key);
    }
    return { patch, restoreKeys };
  }
  const moduleKey = AI_REGION_KEYS.get(region);
  if (!moduleKey) return { patch, restoreKeys };
  if (region === 'video') {
    for (const key of VIDEO_SETTING_FIELDS) {
      if (!equal(inherited?.[key], edited?.[key])) patch[key] = edited?.[key];
      else if (Object.hasOwn(bookPatch || {}, key)) restoreKeys.push(key);
    }
  }
  const rawBookAI = bookPatch?.aiPromptConfig && typeof bookPatch.aiPromptConfig === 'object' ? { ...bookPatch.aiPromptConfig } : {};
  const inheritedModule = inherited?.aiPromptConfig?.[moduleKey] || {};
  const editedModule = edited?.aiPromptConfig?.[moduleKey] || {};
  if (equal(inheritedModule, editedModule)) delete rawBookAI[moduleKey];
  else rawBookAI[moduleKey] = editedModule;
  if (Object.keys(rawBookAI).length) patch.aiPromptConfig = rawBookAI;
  else if (Object.hasOwn(bookPatch || {}, 'aiPromptConfig')) restoreKeys.push('aiPromptConfig');
  return { patch, restoreKeys };
}

function InheritedField({ label, field, value, inherited, options, onChange, loading }) {
  const overridden = !equal(value, inherited);
  return <label className="batch-factory-engine-field"><span><b>{label}</b><small>{overridden ? '覆盖当前书' : '继承当前批量作品配置'}</small></span><Select allowClear loading={loading} value={value || undefined} options={options} placeholder="未配置" onChange={next => onChange(next || '')} /></label>;
}

function InheritedNumberField({ label, value, inherited, min, max, onChange }) {
  const overridden = !equal(value, inherited);
  return <label className="batch-factory-engine-field"><span><b>{label}</b><small>{overridden ? '覆盖当前书' : '继承当前批量作品配置'}</small></span><InputNumber min={min} max={max} value={value ?? inherited ?? undefined} placeholder="未配置" onChange={next => onChange(next ?? '')} /></label>;
}

function InheritedSwitchField({ label, value, inherited, onChange }) {
  const overridden = !equal(value, inherited);
  return <label className="batch-factory-engine-field"><span><b>{label}</b><small>{overridden ? '覆盖当前书' : '继承当前批量作品配置'}</small></span><Switch checked={value ?? inherited ?? false} onChange={onChange} /></label>;
}

function PromptSelect({ label, value, options, onChange, disabled }) {
  return <label className="batch-factory-engine-field"><span><b>{label}</b><small>从个人中心已发布预设词选择</small></span><Select allowClear disabled={disabled} value={value?.presetId || undefined} options={options} placeholder="未选择" onChange={id => onChange(selectedMeta(options.catalog || [], id))} /></label>;
}

function RuleModule({ title, value, onChange, children }) {
  const module = value || {};
  return <section className="batch-factory-ai-module">
    <div className="batch-factory-ai-module-head"><div><b>{title}</b><p>保存后只覆盖当前小说；所选预设及当前编辑内容会随本书配置保存。</p></div><Switch checked={module.enabled === true} onChange={enabled => onChange({ ...module, enabled })} /></div>
    {module.enabled ? <div className="batch-factory-ai-module-body">{children}</div> : null}
  </section>;
}

function ConstraintCategoryEditor({ category, label, value, systemOptions, personalPrompts, loading, saving, editingPromptId, onChange, onSelectSystem, onSelectPersonal, onSaveDraft, onSaveNamed, onEditPersonal, onDeletePersonal }) {
  const isSystem = value.source === 'system';
  const selectedPersonalPrompt = personalPrompts.find(item => item.id === value.personalPromptId);
  return <div className="batch-factory-constraint-layer">
    <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}><b>{label}</b><Switch checked={value.enabled} onChange={enabled => onChange({ enabled })} /></Space>
    {value.enabled ? <>
      <Segmented block options={[{ label: '系统预设', value: 'system' }, { label: '我的提示词', value: 'personal' }]} value={isSystem ? 'system' : 'personal'} onChange={source => onChange(source === 'system' ? { source: 'system', personalPromptId: '' } : { source: value.personalPromptId ? 'personal' : 'draft', presetId: '' })} style={{ marginTop: 10 }} />
      {isSystem ? <Select allowClear showSearch loading={loading} value={value.presetId || undefined} options={systemOptions.map(optionFor)} placeholder="选择系统预设" onChange={onSelectSystem} style={{ width: '100%', marginTop: 8 }} /> : <>
        <Select allowClear loading={loading} value={value.personalPromptId || undefined} options={personalPrompts.map(item => ({ label: item.name || '未命名个人副本', value: item.id }))} placeholder="选择我的提示词，或直接编辑当前草稿" onChange={onSelectPersonal} style={{ width: '100%', marginTop: 8 }} />
        {selectedPersonalPrompt ? <Space size={8} wrap style={{ marginTop: 8 }}><Button size="small" onClick={() => onEditPersonal(selectedPersonalPrompt)}>编辑所选提示词</Button><Popconfirm title="确认删除该个人提示词？" onConfirm={() => onDeletePersonal(selectedPersonalPrompt.id)}><Button size="small" danger>删除</Button></Popconfirm></Space> : null}
      </>}
      <span className="batch-factory-constraint-label">提示词内容</span>
      <Input.TextArea rows={5} value={value.body} placeholder="选择预设后可编辑完整提示词；保存不会修改系统预设。" onChange={event => onChange({ source: 'draft', personalPromptId: '', body: event.target.value })} style={{ marginTop: 6 }} />
      <Space wrap style={{ marginTop: 10 }}><Button loading={saving} onClick={onSaveDraft}>保存当前草稿</Button><Button type="primary" loading={saving} onClick={onSaveNamed}>{editingPromptId ? '保存编辑' : '保存为我的提示词'}</Button></Space>
    </> : null}
  </div>;
}

function ConstraintLayers({ value, records, personalPrompts, loading, saving, editingPromptId, onChange, onSelectSystem, onSelectPersonal, onSaveDraft, onSaveNamed, onEditPersonal, onDeletePersonal }) {
  const rules = normalizeConstraintRules(value);
  return <div className="batch-factory-constraint-layers">
    <div className="batch-factory-constraint-layer"><Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}><div><b>基础设定（人物 / 场景）</b><p>开启后，当前书每个分镜自动带入已提取的人物与场景设定。</p></div><Switch checked={rules.baseSetup.enabled} onChange={enabled => onChange({ ...rules, baseSetup: { enabled } })} /></Space></div>
    {EDITABLE_CONSTRAINT_LAYERS.map(([category, label]) => <ConstraintCategoryEditor key={category} category={category} label={label} value={rules[category]} systemOptions={records.filter(item => item.constraintCategory === category)} personalPrompts={personalPrompts[category] || []} loading={loading} saving={saving === category} editingPromptId={editingPromptId === category} onChange={patch => onChange({ ...rules, [category]: { ...rules[category], ...patch } })} onSelectSystem={presetId => onSelectSystem(category, presetId)} onSelectPersonal={promptId => onSelectPersonal(category, promptId)} onSaveDraft={() => onSaveDraft(category)} onSaveNamed={() => onSaveNamed(category)} onEditPersonal={prompt => onEditPersonal(category, prompt)} onDeletePersonal={promptId => onDeletePersonal(category, promptId)} />)}
  </div>;
}

export function BatchFactoryBookSettingsModal({ open, batch, book, activeRegion = 'engine', onClose, onSaved, onOpenBookAssets }) {
  const batchPatch = batch?.settingsState?.patch || {};
  const bookPatch = book?.settingsState?.patch || {};
  const region = REGION_LABELS[activeRegion] ? activeRegion : 'engine';
  const inherited = useMemo(() => ({ ...batchPatch, aiPromptConfig: mergePromptConfig(batchPatch.aiPromptConfig, {}) }), [batch?.id, batch?.settingsState?.revision]);
  const [form, setForm] = useState(() => effectiveValues(batchPatch, bookPatch));
  const [models, setModels] = useState([]);
  const [catalog, setCatalog] = useState({ script: [], batch: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [personalPrompts, setPersonalPrompts] = useState({});
  const [savingPersonalCategory, setSavingPersonalCategory] = useState('');
  const [editingPersonalPrompt, setEditingPersonalPrompt] = useState({ category: '', id: '', name: '' });
  const [personalPromptNameModal, setPersonalPromptNameModal] = useState({ open: false, category: '', name: '' });

  useEffect(() => {
    if (open) setForm(effectiveValues(batchPatch, bookPatch));
  }, [open, region, batch?.id, batch?.settingsState?.revision, book?.id, book?.settingsState?.revision]);
  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true); setLoadError('');
    Promise.all([
      listAvailableModels('text'), listAvailableModels('image'), listAvailableModels('video'),
      listSystemPresetCatalog('script'), listSystemPresetCatalog('batch-factory')
    ]).then(([text, image, video, scriptResult, batchResult]) => {
      if (!active) return;
      setModels([...text, ...image, ...video]);
      setCatalog({ script: Array.isArray(scriptResult?.catalog) ? scriptResult.catalog : [], batch: Array.isArray(batchResult?.catalog) ? batchResult.catalog : [] });
    }).catch(error => { if (active) setLoadError(error?.message || '读取模型或已发布预设词失败'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open]);
  useEffect(() => {
    if (!open || region !== 'constraints') return;
    EDITABLE_CONSTRAINT_LAYERS.forEach(([category]) => { loadPersonalConstraintPrompts(category); });
  }, [open, region]);

  const modelOptions = useMemo(() => ({
    text: models.filter(item => item.kind === 'text').map(item => ({ value: item.id, label: item.name || item.id })),
    image: models.filter(item => item.kind === 'image').map(item => ({ value: item.id, label: item.name || item.id })),
    video: models.filter(item => item.kind === 'video').map(item => ({ value: item.id, label: item.name || item.id }))
  }), [models]);
  const scriptExtraction = useMemo(() => catalog.script.filter(item => item.kind === 'base' && item.extractionPreset === true), [catalog.script]);
  const scriptConstraints = useMemo(() => catalog.script.filter(item => item.kind === 'addon' && item.constraintCategory), [catalog.script]);
  const batchSlots = useMemo(() => Object.fromEntries(ASSET_SLOTS.slice(1).map(([key, , slot]) => [key, catalog.batch.filter(item => item.slot === slot)])), [catalog.batch]);
  const videoRules = useMemo(() => catalog.batch.filter(item => item.slot === 'batch.video-meta'), [catalog.batch]);
  const visualRules = useMemo(() => catalog.batch.filter(item => item.slot === 'batch.visual-meta'), [catalog.batch]);
  const ai = form.aiPromptConfig || {};
  const assetRules = ai.assets || {};
  const constraintRules = normalizeConstraintRules(ai.constraints);
  const moduleKey = AI_REGION_KEYS.get(region);
  const hasBookOverride = region === 'engine'
    ? ENGINE_OVERRIDE_FIELDS.some(key => Object.hasOwn(bookPatch, key))
    : region === 'video'
      ? VIDEO_SETTING_FIELDS.some(key => Object.hasOwn(bookPatch, key)) || Boolean(moduleKey && Object.hasOwn(bookPatch.aiPromptConfig || {}, moduleKey))
      : Boolean(moduleKey && Object.hasOwn(bookPatch.aiPromptConfig || {}, moduleKey));

  function patch(next) { setForm(current => ({ ...current, ...next })); }
  function patchAI(key, next) { patch({ aiPromptConfig: { ...ai, [key]: next } }); }
  function scoped(module) { return { ...module, scope: 'custom', bookIds: book?.id ? [book.id] : [] }; }
  function updateAssetSelection(key, selection) { patchAI('assets', scoped({ ...assetRules, [key]: selection })); }
  function updateConstraintRules(next) { patchAI('constraints', scoped(withDirectorConstraintSelections(next))); }
  function updateConstraintLayer(category, patch) { updateConstraintRules({ ...constraintRules, [category]: { ...constraintRules[category], ...patch } }); }

  async function loadPersonalConstraintPrompts(category) {
    try {
      const result = await listScriptConstraintPrompts(category);
      setPersonalPrompts(current => ({ ...current, [category]: Array.isArray(result?.prompts) ? result.prompts : [] }));
    } catch (error) {
      message.error(error?.message || '我的提示词加载失败');
    }
  }

  async function selectSystemConstraint(category, presetId) {
    if (!presetId) {
      updateConstraintLayer(category, { source: 'system', presetId: '', presetName: '', presetSlot: '', presetVersion: 0, body: '' });
      return;
    }
    try {
      const result = await getConstraintPresetTexts([presetId]);
      const preset = scriptConstraints.find(item => item.id === presetId);
      updateConstraintLayer(category, { source: 'system', personalPromptId: '', ...selectedMeta(scriptConstraints, presetId), body: String(result?.texts?.[presetId] || ''), presetName: preset?.name || '' });
    } catch (error) {
      message.error(error?.message || '系统预设提示词读取失败');
    }
  }

  function selectPersonalConstraint(category, promptId) {
    const prompt = (personalPrompts[category] || []).find(item => item.id === promptId);
    if (!prompt) {
      updateConstraintLayer(category, { source: 'draft', personalPromptId: '', presetId: '' });
      return;
    }
    updateConstraintLayer(category, { source: 'personal', presetId: '', presetName: '', presetSlot: '', presetVersion: 0, personalPromptId: prompt.id, body: prompt.body || '' });
  }

  async function savePersonalConstraint(category, name) {
    const body = String(constraintRules[category]?.body || '').trim();
    if (!body) return message.warning('请先填写提示词内容');
    if (name !== null && !String(name || '').trim()) return message.warning('请输入提示词名称');
    setSavingPersonalCategory(category);
    try {
      const result = editingPersonalPrompt.category === category && editingPersonalPrompt.id
        ? await updateScriptConstraintPrompt(editingPersonalPrompt.id, { name, body })
        : await saveScriptConstraintPrompt({ category, name, body });
      const saved = result?.prompt;
      if (!saved) throw new Error('提示词保存失败');
      await loadPersonalConstraintPrompts(category);
      updateConstraintLayer(category, { source: 'personal', presetId: '', presetName: '', presetSlot: '', presetVersion: 0, personalPromptId: saved.id, body: saved.body || body });
      setEditingPersonalPrompt({ category: '', id: '', name: '' });
      setPersonalPromptNameModal({ open: false, category: '', name: '' });
      message.success('已保存我的提示词');
    } catch (error) {
      message.error(error?.message || '提示词保存失败');
    } finally {
      setSavingPersonalCategory('');
    }
  }

  async function deletePersonalConstraint(category, promptId) {
    try {
      await deleteScriptConstraintPrompt(promptId);
      await loadPersonalConstraintPrompts(category);
      if (constraintRules[category]?.personalPromptId === promptId) updateConstraintLayer(category, { source: 'draft', personalPromptId: '', body: '' });
      message.success('已删除我的提示词');
    } catch (error) {
      message.error(error?.message || '删除失败');
    }
  }
  async function persist(edited, closeWhenSaved = true) {
    if (!batch?.id || !book?.id) return;
    const { patch: patchValue, restoreKeys } = buildBookRegionUpdate(inherited, bookPatch, region, edited);
    if (!Object.keys(patchValue).length && !restoreKeys.length) { if (closeWhenSaved) onClose?.(); return; }
    setSaving(true);
    try {
      await saveBookOverride(batch.id, book.id, { patch: patchValue, restoreKeys, expectedRevision: Number(book?.revision || 0) });
      await onSaved?.();
      if (closeWhenSaved) onClose?.();
    } finally { setSaving(false); }
  }
  function save() { return persist(form); }
  function restoreCurrentRegion() { return persist(inherited); }

  let body = null;
  if (region === 'engine') {
    body = <div className="batch-factory-engine-drawer">
      <InheritedField label="视频引擎" field="videoProvider" value={form.videoProvider || 'personal_api'} inherited={inherited.videoProvider || 'personal_api'} options={VIDEO_PROVIDER_OPTIONS} loading={false} onChange={videoProvider => patch({ videoProvider })} />
      <InheritedField label="视频模型" field="videoModelId" value={form.videoModelId} inherited={inherited.videoModelId} options={modelOptions.video} loading={loading} onChange={videoModelId => patch({ videoModelId })} />
      <InheritedNumberField label="VIDEO 时长上限" value={form.maxVideoDuration ?? 15} inherited={inherited.maxVideoDuration ?? 15} min={1} max={60} onChange={maxVideoDuration => patch({ maxVideoDuration })} />
      <InheritedSwitchField label="固定开头" value={form.fixedSingleVideo} inherited={inherited.fixedSingleVideo} onChange={fixedSingleVideo => patch({ fixedSingleVideo })} />
      {(form.fixedSingleVideo ?? inherited.fixedSingleVideo) === true ? <InheritedNumberField label="固定 VIDEO 时长" value={form.fixedVideoDuration ?? form.maxVideoDuration ?? 15} inherited={inherited.fixedVideoDuration ?? inherited.maxVideoDuration ?? 15} min={1} max={Number(form.maxVideoDuration ?? inherited.maxVideoDuration ?? 60)} onChange={fixedVideoDuration => patch({ fixedVideoDuration })} /> : null}
      <InheritedField label="画幅" field="aspectRatio" value={form.aspectRatio || '9:16'} inherited={inherited.aspectRatio || '9:16'} options={[{ value: '9:16', label: '9:16' }, { value: '16:9', label: '16:9' }]} loading={false} onChange={aspectRatio => patch({ aspectRatio })} />
      <InheritedField label="图片模型" field="imageModelId" value={form.imageModelId} inherited={inherited.imageModelId} options={modelOptions.image} loading={loading} onChange={imageModelId => patch({ imageModelId })} />
      <InheritedField label="文本模型" field="textModelId" value={form.textModelId} inherited={inherited.textModelId} options={modelOptions.text} loading={loading} onChange={textModelId => patch({ textModelId })} />
    </div>;
  } else if (region === 'assets') {
    body = <><Alert type="info" showIcon message="当前书的人物场景预设" description="人物、场景、道具的实际 Prompt 与图片在本书这一行的“添加角色 / 添加场景 / 添加道具”中维护；这里选择这本书调用的提取与推理预设。" />
      <RuleModule title="资产设置" value={assetRules} onChange={next => patchAI('assets', scoped(next))}>
        <PromptSelect label="人物场景提取" value={assetRules.extraction} options={Object.assign(scriptExtraction.map(optionFor), { catalog: scriptExtraction })} disabled={loading} onChange={selection => updateAssetSelection('extraction', selection)} />
        {ASSET_SLOTS.slice(1).map(([key, label]) => <PromptSelect key={key} label={label} value={assetRules[key]} options={Object.assign((batchSlots[key] || []).map(optionFor), { catalog: batchSlots[key] || [] })} disabled={loading} onChange={selection => updateAssetSelection(key, selection)} />)}
        <Button onClick={() => { onClose?.(); onOpenBookAssets?.(book); }}>维护当前书人物场景预设</Button>
      </RuleModule>
    </>;
  } else if (region === 'constraints') {
    body = <RuleModule title="约束设置" value={constraintRules} onChange={updateConstraintRules}>
      <ConstraintLayers value={constraintRules} records={scriptConstraints} personalPrompts={personalPrompts} loading={loading} saving={savingPersonalCategory} editingPromptId={editingPersonalPrompt.category} onChange={updateConstraintRules} onSelectSystem={selectSystemConstraint} onSelectPersonal={selectPersonalConstraint} onSaveDraft={category => savePersonalConstraint(category, null)} onSaveNamed={category => setPersonalPromptNameModal({ open: true, category, name: editingPersonalPrompt.category === category ? editingPersonalPrompt.name : '' })} onEditPersonal={(category, prompt) => { setEditingPersonalPrompt({ category, id: prompt.id, name: prompt.name || '' }); updateConstraintLayer(category, { source: 'draft', presetId: '', personalPromptId: '', body: prompt.body || '' }); }} onDeletePersonal={deletePersonalConstraint} />
    </RuleModule>;
  } else if (region === 'video') {
    body = <><div className="batch-factory-engine-drawer">
      <InheritedNumberField label="VIDEO 时长上限" value={form.maxVideoDuration ?? 15} inherited={inherited.maxVideoDuration ?? 15} min={1} max={60} onChange={maxVideoDuration => patch({ maxVideoDuration })} />
      <InheritedSwitchField label="固定开头" value={form.fixedSingleVideo} inherited={inherited.fixedSingleVideo} onChange={fixedSingleVideo => patch({ fixedSingleVideo })} />
      {(form.fixedSingleVideo ?? inherited.fixedSingleVideo) === true ? <InheritedNumberField label="固定 VIDEO 时长" value={form.fixedVideoDuration ?? form.maxVideoDuration ?? 15} inherited={inherited.fixedVideoDuration ?? inherited.maxVideoDuration ?? 15} min={1} max={Number(form.maxVideoDuration ?? inherited.maxVideoDuration ?? 60)} onChange={fixedVideoDuration => patch({ fixedVideoDuration })} /> : null}
    </div><RuleModule title="视频提示词" value={ai.video} onChange={next => patchAI('video', scoped(next))}>
      <PromptSelect label="视频提示词" value={ai.video} options={Object.assign(videoRules.map(optionFor), { catalog: videoRules })} disabled={loading} onChange={selection => patchAI('video', scoped({ ...ai.video, ...selection }))} />
    </RuleModule></>;
  } else {
    body = <RuleModule title="画面设置" value={ai.visual} onChange={next => patchAI('visual', scoped(next))}>
      <PromptSelect label="画面提示词" value={ai.visual} options={Object.assign(visualRules.map(optionFor), { catalog: visualRules })} disabled={loading} onChange={selection => patchAI('visual', scoped({ ...ai.visual, ...selection }))} />
    </RuleModule>;
  }

  return <><Modal title={book?.title ? `单书配置 · ${book.title} · ${REGION_LABELS[region]}` : `单书配置 · ${REGION_LABELS[region]}`} open={open} onCancel={onClose} width={980} className="shuihuo-engine-modal batch-factory-engine-modal" footer={<Space>{hasBookOverride ? <Button danger disabled={saving} onClick={restoreCurrentRegion}>恢复作品配置</Button> : null}<Button onClick={onClose}>取消</Button><Button type="primary" loading={saving} onClick={save}>保存当前书覆盖</Button></Space>}>
    <Alert type="info" showIcon message="继承状态" description="本分区未改动时继续使用当前批量作品配置；保存或恢复只影响当前小说，不会改动同批次其它书。" />
    {loadError ? <Alert type="warning" showIcon message="配置目录读取失败" description={loadError} /> : null}
    <Divider orientation="left">{REGION_LABELS[region]}</Divider>
    {body}
  </Modal><Modal title={editingPersonalPrompt.id ? '编辑我的提示词' : '保存为我的提示词'} open={personalPromptNameModal.open} onCancel={() => { setPersonalPromptNameModal({ open: false, category: '', name: '' }); setEditingPersonalPrompt({ category: '', id: '', name: '' }); }} onOk={() => savePersonalConstraint(personalPromptNameModal.category, personalPromptNameModal.name.trim())} okText="保存" confirmLoading={savingPersonalCategory === personalPromptNameModal.category}><Input autoFocus value={personalPromptNameModal.name} placeholder="提示词名称" onChange={event => setPersonalPromptNameModal(current => ({ ...current, name: event.target.value }))} /></Modal></>;
}
