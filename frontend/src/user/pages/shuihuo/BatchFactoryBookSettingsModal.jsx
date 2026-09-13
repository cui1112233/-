import { Alert, Button, Divider, Modal, Select, Space, Switch } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { listAvailableModels } from '../../../shared/api/modelCatalog';
import { listSystemPresetCatalog, saveBookOverride } from '../../../shared/api/batchFactoryV11';

const BOOK_OVERRIDE_FIELDS = ['textModelId', 'imageModelId', 'videoModelId', 'videoProvider', 'aspectRatio', 'productionMode', 'maxVideoDuration', 'fixedSingleVideo', 'fixedVideoDuration', 'aiPromptConfig'];
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
  return preset ? { presetId: preset.id, presetName: preset.name, presetSlot: preset.slot, presetVersion: preset.version } : { presetId: '' };
}
function optionFor(preset) { return { value: preset.id, label: `${preset.name || preset.id} · v${preset.version || 1}` }; }

export function buildBookOverridePatch(inherited, edited) {
  return Object.fromEntries(BOOK_OVERRIDE_FIELDS
    .filter(key => !equal(inherited?.[key], edited?.[key]))
    .map(key => [key, edited[key]]));
}

function buildRestoreKeys(inherited, edited, currentPatch) {
  return BOOK_OVERRIDE_FIELDS.filter(key => Object.hasOwn(currentPatch || {}, key) && equal(inherited?.[key], edited?.[key]));
}

function InheritedField({ label, field, value, inherited, options, onChange, loading }) {
  const overridden = !equal(value, inherited);
  return <label className="batch-factory-engine-field"><span><b>{label}</b><small>{overridden ? '覆盖当前书' : '继承当前批量作品配置'}</small></span><Select allowClear loading={loading} value={value || undefined} options={options} placeholder="未配置" onChange={next => onChange(next || '')} /></label>;
}

function PromptSelect({ label, value, options, onChange, disabled }) {
  return <label className="batch-factory-engine-field"><span><b>{label}</b><small>从个人中心已发布预设词选择</small></span><Select allowClear disabled={disabled} value={value?.presetId || undefined} options={options} placeholder="未选择" onChange={id => onChange(selectedMeta(options.catalog || [], id))} /></label>;
}

function RuleModule({ title, value, onChange, children }) {
  const module = value || {};
  return <section className="batch-factory-ai-module">
    <div className="batch-factory-ai-module-head"><div><b>{title}</b><p>保存后只覆盖当前小说；预设正文由服务端冻结，不回传浏览器。</p></div><Switch checked={module.enabled === true} onChange={enabled => onChange({ ...module, enabled })} /></div>
    {module.enabled ? <div className="batch-factory-ai-module-body">{children}</div> : null}
  </section>;
}

export function BatchFactoryBookSettingsModal({ open, batch, book, onClose, onSaved }) {
  const batchPatch = batch?.settingsState?.patch || {};
  const bookPatch = book?.settingsState?.patch || {};
  const inherited = useMemo(() => ({ ...batchPatch, aiPromptConfig: mergePromptConfig(batchPatch.aiPromptConfig, {}) }), [batch?.id, batch?.settingsState?.revision]);
  const [form, setForm] = useState(() => effectiveValues(batchPatch, bookPatch));
  const [models, setModels] = useState([]);
  const [catalog, setCatalog] = useState({ script: [], batch: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (open) setForm(effectiveValues(batchPatch, bookPatch));
  }, [open, batch?.id, batch?.settingsState?.revision, book?.id, book?.settingsState?.revision]);
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
  const sourceByField = useMemo(() => Object.fromEntries(BOOK_OVERRIDE_FIELDS.map(field => [field, Object.hasOwn(bookPatch, field) ? 'book' : 'batch'])), [book?.id, book?.settingsState?.revision, batch?.settingsState?.revision]);
  const ai = form.aiPromptConfig || {};
  const assetRules = ai.assets || {};

  function patch(next) { setForm(current => ({ ...current, ...next })); }
  function patchAI(key, next) { patch({ aiPromptConfig: { ...ai, [key]: next } }); }
  function scoped(module) { return { ...module, scope: 'custom', bookIds: book?.id ? [book.id] : [] }; }
  function updateAssetSelection(key, selection) { patchAI('assets', scoped({ ...assetRules, [key]: selection })); }
  async function save() {
    if (!batch?.id || !book?.id) return;
    const patch = buildBookOverridePatch(inherited, form);
    const restoreKeys = buildRestoreKeys(inherited, form, bookPatch);
    if (!Object.keys(patch).length && !restoreKeys.length) { onClose?.(); return; }
    setSaving(true);
    try {
      await saveBookOverride(batch.id, book.id, { patch, restoreKeys, expectedRevision: Number(book?.revision || 0) });
      await onSaved?.();
      onClose?.();
    } finally { setSaving(false); }
  }

  return <Modal title={book?.title ? `单书配置 · ${book.title}` : '单书配置'} open={open} onCancel={onClose} width={980} className="shuihuo-engine-modal batch-factory-engine-modal" footer={<Space><Button onClick={onClose}>取消</Button><Button type="primary" loading={saving} onClick={save}>保存当前书覆盖</Button></Space>}>
    <Alert type="info" showIcon message="继承状态" description={`未改动的字段继续使用当前批量作品配置；当前模型来源：${sourceByField.textModelId === 'book' ? '当前书覆盖' : '批量作品'}。这里保存的值只影响当前小说，不会改动同批次其它书。`} />
    {loadError ? <Alert type="warning" showIcon message="配置目录读取失败" description={loadError} /> : null}
    <Divider orientation="left">模型与生产</Divider>
    <div className="batch-factory-engine-drawer">
      <InheritedField label="文本模型" field="textModelId" value={form.textModelId} inherited={inherited.textModelId} options={modelOptions.text} loading={loading} onChange={textModelId => patch({ textModelId })} />
      <InheritedField label="图片模型" field="imageModelId" value={form.imageModelId} inherited={inherited.imageModelId} options={modelOptions.image} loading={loading} onChange={imageModelId => patch({ imageModelId })} />
      <InheritedField label="视频模型" field="videoModelId" value={form.videoModelId} inherited={inherited.videoModelId} options={modelOptions.video} loading={loading} onChange={videoModelId => patch({ videoModelId })} />
      <InheritedField label="画幅" field="aspectRatio" value={form.aspectRatio || '9:16'} inherited={inherited.aspectRatio || '9:16'} options={[{ value: '9:16', label: '9:16' }, { value: '16:9', label: '16:9' }]} loading={false} onChange={aspectRatio => patch({ aspectRatio })} />
    </div>
    <Divider orientation="left">AI 推理规则</Divider>
    <RuleModule title="资产设置" value={assetRules} onChange={next => patchAI('assets', scoped(next))}>
      <PromptSelect label="人物场景提取" value={assetRules.extraction} options={Object.assign(scriptExtraction.map(optionFor), { catalog: scriptExtraction })} disabled={loading} onChange={selection => updateAssetSelection('extraction', selection)} />
      {ASSET_SLOTS.slice(1).map(([key, label]) => <PromptSelect key={key} label={label} value={assetRules[key]} options={Object.assign((batchSlots[key] || []).map(optionFor), { catalog: batchSlots[key] || [] })} disabled={loading} onChange={selection => updateAssetSelection(key, selection)} />)}
    </RuleModule>
    <RuleModule title="约束设置" value={ai.constraints} onChange={next => patchAI('constraints', scoped(next))}>
      <label className="batch-factory-engine-field"><span><b>剧本生成约束</b><small>可多选个人中心已发布的剧本约束预设</small></span><Select mode="multiple" value={(ai.constraints?.selections || []).map(item => item.presetId).filter(Boolean)} options={scriptConstraints.map(optionFor)} loading={loading} onChange={ids => patchAI('constraints', scoped({ ...ai.constraints, selections: ids.map(id => selectedMeta(scriptConstraints, id)) }))} placeholder="选择约束预设" /></label>
    </RuleModule>
    <RuleModule title="视频设置" value={ai.video} onChange={next => patchAI('video', scoped(next))}><PromptSelect label="视频提示词" value={ai.video} options={Object.assign(videoRules.map(optionFor), { catalog: videoRules })} disabled={loading} onChange={selection => patchAI('video', scoped({ ...ai.video, ...selection }))} /></RuleModule>
    <RuleModule title="画面设置" value={ai.visual} onChange={next => patchAI('visual', scoped(next))}><PromptSelect label="画面提示词" value={ai.visual} options={Object.assign(visualRules.map(optionFor), { catalog: visualRules })} disabled={loading} onChange={selection => patchAI('visual', scoped({ ...ai.visual, ...selection }))} /></RuleModule>
  </Modal>;
}
