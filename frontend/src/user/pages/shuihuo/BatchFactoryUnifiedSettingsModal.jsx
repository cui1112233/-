import { SettingOutlined } from '@ant-design/icons';
import { Alert, Button, Divider, Input, InputNumber, Modal, Segmented, Select, Space, Switch, Tabs, Tooltip, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { listAvailableModels } from '../../../shared/api/modelCatalog';
import {
  createAutomationPreset,
  deleteAutomationPreset,
  listAutomationPresets,
  listSystemPresetCatalog,
  updateAutomationPreset
} from '../../../shared/api/batchFactoryV11';
import { videoProviderForModel } from './videoProviderBinding';

const clone = value => JSON.parse(JSON.stringify(value || {}));
const DEFAULT_TTS = { voice: 'zh-CN-XiaoxiaoNeural', style: 'general', speed: 1.8, pitch: 10 };
const voices = [
  { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女声·温柔）' },
  { value: 'zh-CN-XiaochenNeural', label: '晓辰（女声·知性）' },
  { value: 'zh-CN-YunxiNeural', label: '云希（男声·清朗）' },
  { value: 'zh-CN-YunyangNeural', label: '云扬（男声·阳光）' }
];
const styles = ['general', 'cheerful', 'sad', 'friendly', 'chat'].map(value => ({ value, label: value === 'general' ? '通用' : value }));
const selectOption = preset => ({ value: preset.id, label: `${preset.name || preset.id} · v${preset.version || 1}` });
const presetValue = preset => preset ? { presetId: preset.id, presetName: preset.name || preset.id, presetSlot: preset.slot || '', presetVersion: preset.version || 1, constraintCategory: preset.constraintCategory || '' } : { presetId: '', presetName: '', presetSlot: '', presetVersion: null, constraintCategory: '' };

export function BatchFactoryEngineSettingsForm({ value, onChange, sections = ['models', 'audio', 'publish'], active = true }) {
  const [models, setModels] = useState([]);
  const [modelsError, setModelsError] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelReloadKey, setModelReloadKey] = useState(0);
  const patch = next => onChange({ ...value, ...next });
  const tts = { ...DEFAULT_TTS, ...(value.tts || {}) };
  const modelSettingsEnabled = sections.includes('models');
  const modelOptions = useMemo(() => {
    const asOptions = kind => models.filter(model => model.kind === kind).map(model => ({ value: model.id, label: model.displayName || model.name || model.modelId || model.id }));
    return { text: asOptions('text'), image: asOptions('image'), video: asOptions('video') };
  }, [models]);
  useEffect(() => {
    if (!active || !modelSettingsEnabled) return undefined;
    let alive = true;
    setModelsLoading(true);
    setModelsError('');
    Promise.all(['text', 'image', 'video'].map(listAvailableModels)).then(groups => {
      if (alive) setModels(groups.flat());
    }).catch(error => {
      if (!alive) return;
      setModels([]);
      setModelsError(error?.message || '未能读取个人中心已启用模型');
    }).finally(() => { if (alive) setModelsLoading(false); });
    return () => { alive = false; };
  }, [active, modelSettingsEnabled, modelReloadKey]);
  const publish = value.publishSettings || {};
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Alert type="info" showIcon message="当前批次统一生产参数" description="保存后作为全部小说的默认值；单书已保存的显式覆盖不会被预设载入或本页保存清空。" />
    {modelSettingsEnabled ? <><section className="batch-factory-engine-card"><header><b>模型配置</b><small>文本、图片、视频和配音</small></header><div className="batch-factory-engine-card-body batch-factory-engine-grid">
      <label className="batch-factory-engine-field"><span><b>文本模型</b></span><Select allowClear loading={modelsLoading} value={value.textModelId || undefined} options={modelOptions.text} placeholder="选择已启用文本模型" onChange={textModelId => patch({ textModelId: textModelId || '' })} /></label>
      <label className="batch-factory-engine-field"><span><b>图片模型</b></span><Select allowClear loading={modelsLoading} value={value.imageModelId || undefined} options={modelOptions.image} placeholder="选择已启用图片模型" onChange={imageModelId => patch({ imageModelId: imageModelId || '' })} /></label>
      <label className="batch-factory-engine-field"><span><b>视频模型</b></span><Select allowClear loading={modelsLoading} value={value.videoModelId || undefined} options={modelOptions.video} placeholder="选择已启用视频模型" onChange={videoModelId => patch({ videoModelId: videoModelId || '', ...(videoModelId ? { videoProvider: videoProviderForModel(videoModelId, value.videoProvider) } : {}) })} /></label>
      <label className="batch-factory-engine-field"><span><b>画幅</b></span><Segmented value={value.aspectRatio || '9:16'} options={['9:16', '16:9', '1:1']} onChange={aspectRatio => patch({ aspectRatio })} /></label>
      <label className="batch-factory-engine-field"><span><b>分镜时长</b></span><Segmented value={Number(value.storyboardDurationLimit) === 15 ? 15 : 10} options={[{ value: 10, label: '10 秒' }, { value: 15, label: '15 秒' }]} onChange={storyboardDurationLimit => patch({ storyboardDurationLimit, maxVideoDuration: storyboardDurationLimit })} /></label>
      <label className="batch-factory-engine-field"><span><b>配音音色</b></span><Select value={tts.voice} options={voices} onChange={voice => patch({ tts: { ...tts, voice } })} /></label>
      <label className="batch-factory-engine-field"><span><b>配音风格</b></span><Select value={tts.style} options={styles} onChange={style => patch({ tts: { ...tts, style } })} /></label>
      <label className="batch-factory-engine-field"><span><b>语速</b></span><InputNumber min={0.5} max={2} step={0.1} value={tts.speed} onChange={speed => patch({ tts: { ...tts, speed: speed ?? DEFAULT_TTS.speed } })} /></label>
    </div></section>
    {modelsError ? <Alert type="warning" showIcon message="模型目录暂不可用" description={<Space direction="vertical"><span>{modelsError}</span><Button size="small" onClick={() => setModelReloadKey(value => value + 1)}>重试读取模型</Button></Space>} /> : null}
    {!modelsLoading && !modelsError && !models.length ? <Alert type="warning" showIcon message="个人中心没有已启用模型" description={<Space direction="vertical"><span>请先在个人中心按文本、图片、视频类型新增并启用模型，再返回当前批量作品选择。</span><Button type="link" href="/api-config">前往个人中心配置模型</Button></Space>} /> : null}
    </> : null}
    {sections.includes('audio') ? <section className="batch-factory-engine-card"><header><b>跟随配音</b><small>开启后只测量没有有效缓存的视频原文非空行。</small></header><div className="batch-factory-engine-card-body"><Space direction="vertical" style={{ width: '100%' }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}><span>分镜规划跟随配音</span><Switch checked={value.audioPlanningEnabled === true} onChange={audioPlanningEnabled => patch({ audioPlanningEnabled })} /></Space>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}><span>合并跟随配音</span><Switch checked={value.audioMergeEnabled === true} onChange={audioMergeEnabled => patch({ audioMergeEnabled })} /></Space>
    </Space></div></section> : null}
    {sections.includes('publish') ? <section className="batch-factory-engine-card"><header><b>发布统一</b><small>视频管理系统的批量默认上传设置。</small></header><div className="batch-factory-engine-card-body batch-factory-engine-grid">
      <label className="batch-factory-engine-field"><span><b>网站配置档</b></span><Input value={publish.versionProfile || ''} placeholder="例如：女频短剧版" onChange={event => patch({ publishSettings: { ...publish, versionProfile: event.target.value } })} /></label>
      <label className="batch-factory-engine-field"><span><b>上传视频类型</b></span><Segmented value={publish.uploadVideoType || 'merged'} options={[{ value: 'merged', label: '合并成品' }, { value: 'individual', label: '独立 VIDEO' }]} onChange={uploadVideoType => patch({ publishSettings: { ...publish, uploadVideoType } })} /></label>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}><span>改文后上传</span><Switch checked={value.publishRewriteEnabled === true} onChange={publishRewriteEnabled => patch({ publishRewriteEnabled })} /></Space>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}><span>素材复用</span><Switch checked={publish.materialReuse === true} onChange={materialReuse => patch({ publishSettings: { ...publish, materialReuse } })} /></Space>
    </div></section> : null}
  </Space>;
}

export function BatchFactoryAiReasoningForm({ value, onChange }) {
  const [catalog, setCatalog] = useState([]);
  const config = value && typeof value === 'object' ? value : {};
  const assets = config.assets || {};
  const constraints = config.constraints || {};
  const derivedOpening = config.derivedOpening || {};
  const video = config.video || {};
  const visual = config.visual || {};
  useEffect(() => {
    let active = true;
    Promise.all([listSystemPresetCatalog('script'), listSystemPresetCatalog('batch-factory')]).then(results => {
      if (active) setCatalog(results.flatMap(result => Array.isArray(result?.catalog) ? result.catalog : []));
    }).catch(() => active && setCatalog([]));
    return () => { active = false; };
  }, []);
  const bySlot = slot => catalog.filter(item => item.slot === slot).map(selectOption);
  const bySlots = slots => catalog.filter(item => slots.includes(item.slot)).map(selectOption);
  const byConstraint = category => catalog.filter(item => item.kind === 'addon' && item.constraintCategory === category).map(selectOption);
  const updateConstraint = (category, presetId) => {
    const selected = catalog.find(item => item.id === presetId);
    const rest = (constraints.selections || []).filter(item => item.constraintCategory !== category);
    onChange({ ...config, constraints: { ...constraints, enabled: true, enabledCategories: [...new Set([...(constraints.enabledCategories || []), category])], selections: selected ? [...rest, presetValue(selected)] : rest } });
  };
  const selectedConstraint = category => (constraints.selections || []).find(item => item.constraintCategory === category)?.presetId;
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Alert type="info" showIcon message="AI 推理" description="选择规则后，资产提取、智能统一、导演分镜和最终 Prompt 都共用同一份批量草稿。" />
    <section className="batch-factory-engine-card"><header><b>资产设置</b><small>H3 选项会按名单、事实、关系和全部人物外形的两次调用运行。</small></header><div className="batch-factory-engine-card-body">
      <label className="batch-factory-engine-field"><span><b>人物场景道具提示词</b></span><Select allowClear value={assets.extraction?.presetId || undefined} options={bySlot('script.asset-extraction')} placeholder="选择已发布预设词" onChange={presetId => onChange({ ...config, assets: { ...assets, enabled: true, extraction: presetValue(catalog.find(item => item.id === presetId)) } })} /></label>
    </div></section>
    <section className="batch-factory-engine-card"><header><b>约束设置</b><small>智能统一只有这里的画面前缀入口；基础设定和画面限制只控制最终注入层。</small></header><div className="batch-factory-engine-card-body batch-factory-engine-grid">
      <label className="batch-factory-engine-field"><span><b>画面前缀词（智能统一）</b></span><Select allowClear value={selectedConstraint('prefix')} options={byConstraint('prefix')} placeholder="选择系统预设" onChange={presetId => updateConstraint('prefix', presetId)} /></label>
      <label className="batch-factory-engine-field"><span><b>画面限制</b></span><Select allowClear value={selectedConstraint('restriction')} options={byConstraint('restriction')} placeholder="选择系统预设" onChange={presetId => updateConstraint('restriction', presetId)} /></label>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}><span>基础设定</span><Switch checked={constraints.baseSetup?.enabled !== false} onChange={enabled => onChange({ ...config, constraints: { ...constraints, baseSetup: { enabled } } })} /></Space>
    </div></section>
    <section className="batch-factory-engine-card"><header><b>视频设置</b><small>视频提示词决定结构化导演分镜的输出规则与最终模板。</small></header><div className="batch-factory-engine-card-body">
      <label className="batch-factory-engine-field"><span><b>衍生开篇</b></span><Select allowClear value={derivedOpening.presetId || undefined} options={bySlots(['batch.hook-adaptation', 'batch.original-director', 'batch.viral-director'])} placeholder="选择已发布衍生开篇提示词" onChange={presetId => onChange({ ...config, derivedOpening: { ...derivedOpening, ...presetValue(catalog.find(item => item.id === presetId)), enabled: Boolean(presetId) } })} /></label>
      <label className="batch-factory-engine-field"><span><b>视频提示词</b></span><Select value={video.presetId || undefined} options={bySlot('batch.video-meta')} placeholder="选择已发布视频提示词" onChange={presetId => onChange({ ...config, video: { ...video, ...presetValue(catalog.find(item => item.id === presetId)), enabled: true } })} /></label>
      <label className="batch-factory-engine-field"><span><b>画面提示词</b></span><Select allowClear value={visual.presetId || undefined} options={bySlot('batch.visual-meta')} placeholder="选择已发布画面提示词" onChange={presetId => onChange({ ...config, visual: { ...visual, ...presetValue(catalog.find(item => item.id === presetId)) } })} /></label>
    </div></section>
  </Space>;
}

export function BatchFactoryUnifiedSettingsModal({ open, batch, onClose, onSaved }) {
  const [draftPatch, setDraftPatch] = useState({});
  const [saving, setSaving] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [presets, setPresets] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presetBusy, setPresetBusy] = useState(false);
  const selectedPreset = presets.find(item => item.id === selectedPresetId);
  useEffect(() => {
    if (open) setDraftPatch(clone(batch?.settingsState?.patch));
  }, [open, batch?.id, batch?.settingsState?.revision]);
  const loadPresets = async () => {
    const result = await listAutomationPresets();
    const values = Array.isArray(result?.presets) ? result.presets : [];
    setPresets(values);
    return values;
  };
  const openPresetManager = async () => {
    try { await loadPresets(); setPresetOpen(true); }
    catch (error) { message.error(error?.message || '读取自动化预设失败'); }
  };
  const clonePresetConfig = clone(selectedPreset?.config);
  const loadPreset = () => {
    if (!selectedPreset) return message.warning('请先选择自动化预设');
    Modal.confirm({ title: '确认载入此预设', content: '它只替换当前统一配置草稿；点击主弹窗的“保存统一配置”后才会写入批量。', okText: '载入草稿', onOk: () => setDraftPatch(clonePresetConfig) });
  };
  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return message.warning('请填写预设名称');
    setPresetBusy(true);
    try { const result = await createAutomationPreset({ name, config: draftPatch }); const saved = result?.preset || result; await loadPresets(); setSelectedPresetId(saved?.id || ''); setPresetName(''); message.success('已保存自动化预设。'); }
    catch (error) { message.error(error?.message || '保存自动化预设失败'); }
    finally { setPresetBusy(false); }
  };
  const renamePreset = async () => {
    if (!selectedPreset) return message.warning('请先选择自动化预设');
    const name = presetName.trim();
    if (!name) return message.warning('请填写新的预设名称');
    setPresetBusy(true);
    try { await updateAutomationPreset(selectedPreset.id, { name, config: selectedPreset.config, expectedVersion: selectedPreset.version }); await loadPresets(); setPresetName(''); message.success('自动化预设已重命名。'); }
    catch (error) { message.error(error?.message || '重命名自动化预设失败'); }
    finally { setPresetBusy(false); }
  };
  const removePreset = () => {
    if (!selectedPreset) return message.warning('请先选择自动化预设');
    Modal.confirm({ title: '删除所选预设', content: `删除“${selectedPreset.name}”不会影响已经排期或执行中的任务。`, okText: '删除', okButtonProps: { danger: true }, onOk: async () => { await deleteAutomationPreset(selectedPreset.id); setSelectedPresetId(''); await loadPresets(); } });
  };
  const save = async () => {
    setSaving(true);
    try { const result = await onSaved({ patch: draftPatch, expectedRevision: Number(batch?.settingsState?.revision || 0) }); if (result !== false) onClose(); }
    finally { setSaving(false); }
  };
  return <><Modal title={<Space><Tooltip title="自动化预设"><Button type="text" icon={<SettingOutlined />} aria-label="自动化预设" onClick={openPresetManager} /></Tooltip><span>统一配置</span></Space>} open={open} onCancel={onClose} width={980} destroyOnClose={false} className="batch-factory-unified-settings-modal" footer={<Space><Button onClick={onClose}>取消</Button><Button type="primary" loading={saving} onClick={save}>保存统一配置</Button></Space>}>
    <Tabs items={[
      { key: 'models', label: '模型配置', children: <BatchFactoryEngineSettingsForm value={draftPatch} onChange={setDraftPatch} sections={['models', 'audio']} active={open} /> },
      { key: 'reasoning', label: 'AI 推理', children: <BatchFactoryAiReasoningForm value={draftPatch.aiPromptConfig} onChange={aiPromptConfig => setDraftPatch(current => ({ ...current, aiPromptConfig }))} /> },
      { key: 'publish', label: '发布统一', children: <BatchFactoryEngineSettingsForm value={draftPatch} onChange={setDraftPatch} sections={['publish']} active={open} /> }
    ]} />
  </Modal>
  <Modal title="自动化预设" open={presetOpen} onCancel={() => setPresetOpen(false)} footer={null} width={620} destroyOnClose><Space direction="vertical" size={14} style={{ width: '100%' }}>
    <Alert type="info" showIcon message="预设只保存统一配置" description="不保存正文、资产、导演结果或视频结果；载入后仍须保存统一配置才会应用到当前批量。" />
    <label className="batch-factory-engine-field"><span><b>已保存预设</b></span><Select allowClear value={selectedPresetId || undefined} onChange={setSelectedPresetId} placeholder="选择自动化预设" options={presets.map(item => ({ value: item.id, label: `${item.name} · v${item.version}` }))} /></label>
    <Space wrap><Button disabled={!selectedPreset} onClick={loadPreset}>载入预设</Button></Space>
    <Divider />
    <label className="batch-factory-engine-field"><span><b>{selectedPreset ? '预设新名称' : '新预设名称'}</b></span><Input value={presetName} maxLength={255} placeholder={selectedPreset?.name || '例如：女频 H3 全自动'} onChange={event => setPresetName(event.target.value)} /></label>
    <Space wrap><Button type="primary" loading={presetBusy} onClick={savePreset}>保存为新预设</Button><Button disabled={!selectedPreset} loading={presetBusy} onClick={renamePreset}>重命名所选预设</Button><Button danger disabled={!selectedPreset} onClick={removePreset}>删除所选预设</Button></Space>
  </Space></Modal></>;
}
