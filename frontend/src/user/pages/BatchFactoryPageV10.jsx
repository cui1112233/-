import {
  Alert,
  Button,
  Card,
  Collapse,
  Divider,
  Drawer,
  Empty,
  Input,
  InputNumber,
  List,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Typography,
  message
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import {
  approveBatchFactoryHook,
  compileBatchFactoryVideo,
  createBatchFactoryBatch,
  generateBatchFactoryBatch,
  generateBatchFactoryVideo,
  generateBatchFactoryVideos,
  getBatchFactoryBatch,
  getBatchFactoryIntake,
  getBatchFactoryMergeCapability,
  getBatchFactoryProductionStatus,
  getBatchFactoryPromptCatalog,
  listBatchFactoryBatches,
  mergeBatchFactoryVideos,
  regenerateBatchFactoryDirector,
  rewriteBatchFactoryHook,
  startBatchFactoryBatch,
  updateBatchFactoryDirectorResult,
  updateBatchFactoryPublishSettings,
  updateBatchFactorySettings,
  updateBatchFactorySource
} from '../../shared/api/batchFactory';
import { getConfig } from '../../shared/api/config';
import { downloadMedia, listModels } from '../../shared/api/shuihuoProduction';
import { textToSpeech } from '../../shared/api/tts';
import { BatchFactoryBookSettings } from './batch-factory/BatchFactoryBookSettings';

const MERGE_SOURCE = 'batch_merge';
const ACTIVE_DIRECTOR = new Set(['queued_hook', 'hook_generating', 'queued_director', 'director_generating']);
const DEFAULT_SCRIPT = 'standard-short-drama';
const DEFAULT_ASSET = 'standard-asset-extraction';

const styles = {
  page: { width: '100%', minWidth: 0 },
  columns: { display: 'grid', gridTemplateColumns: 'minmax(230px,.72fr) minmax(450px,1.48fr) minmax(360px,1.05fr)', gap: 12, alignItems: 'start' },
  sticky: { position: 'sticky', top: 12 },
  list: { maxHeight: '72vh', overflow: 'auto' },
  item: { padding: 10, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(127,127,127,.18)', marginBottom: 8 },
  selected: { outline: '2px solid #1677ff' },
  overridden: { borderInlineStart: '3px solid #7c3aed' },
  full: { width: '100%' },
  player: { minHeight: 250, background: '#050505', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  section: { padding: 12, borderRadius: 8, border: '1px solid rgba(127,127,127,.14)' }
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function visualPrompt(video) { return String(video?.visualPrompt || video?.visual_prompt || video?.video_desc || video?.videoDesc || '').trim(); }
function projectIds(batch) { return [...new Set((batch?.items || []).map(item => Number(item.production?.projectId)).filter(id => id > 0))]; }
function mergedMedia(status) { return [...(status?.media || [])].reverse().find(item => item.source === MERGE_SOURCE) || null; }
function videoLabel(video) { return `VIDEO${String(video?.id ?? '').padStart(2, '0')}`; }

function videoProduction(item, index, status) {
  if (!item?.production?.projectId) return { status: 'draft', media: null, task: null, error: '' };
  const submission = (item.productionResults || []).find(result => Number(result.index) === index + 1) || item.productionResults?.[index] || null;
  const segmentId = Number(submission?.segmentId || submission?.task?.segmentId || 0);
  const submittedTaskId = Number(submission?.task?.id || 0);
  const tasks = [...(status?.tasks || [])].reverse();
  const task = (segmentId ? tasks.find(entry => Number(entry.segmentId) === segmentId) : null)
    || (submittedTaskId ? tasks.find(entry => Number(entry.id) === submittedTaskId) : null)
    || submission?.task
    || null;
  const mediaRows = [...(status?.media || [])].reverse().filter(entry => entry.source !== MERGE_SOURCE);
  const media = task?.id
    ? mediaRows.find(entry => Number(entry.taskId) === Number(task.id)) || null
    : (segmentId ? mediaRows.find(entry => Number(entry.segmentId) === segmentId) || null : null);
  const statusValue = media ? 'succeeded' : (submission?.error ? 'failed' : (task?.status || (submission ? 'prepared' : 'draft')));
  return { status: statusValue, media, task, error: submission?.error || task?.errorMessage || '' };
}

function itemStatus(item, status) {
  if (item?.status === 'failed' || item?.productionSubmissionError) return ['异常', 'red'];
  if (ACTIVE_DIRECTOR.has(item?.status)) return ['导演中', 'processing'];
  if (item?.status === 'hook_review') return ['待审核', 'gold'];
  if (!item?.directorResult?.storyboard?.length) return ['待导演', 'default'];
  if (!item?.production?.projectId) return ['待生成', 'blue'];
  const states = item.directorResult.storyboard.map((_, index) => videoProduction(item, index, status).status);
  if (states.some(value => value === 'failed' || value === 'cancelled')) return ['视频异常', 'red'];
  if (states.some(value => value === 'running')) return ['生成中', 'processing'];
  if (states.some(value => value === 'queued')) return ['排队中', 'processing'];
  if (states.some(value => value === 'prepared' || value === 'draft')) return ['部分待生成', 'blue'];
  if (states.length && states.every(value => value === 'succeeded')) return [mergedMedia(status) ? '已合并' : '待合并', mergedMedia(status) ? 'green' : 'cyan'];
  return ['处理中', 'processing'];
}

function audioDuration(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = Number(audio.duration);
      URL.revokeObjectURL(url);
      Number.isFinite(duration) && duration > 0 ? resolve(duration) : reject(new Error('无法读取 TTS 音频时长'));
    };
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取 TTS 音频元数据')); };
    audio.src = url;
  });
}

function Setup({ onCreated }) {
  const [items, setItems] = useState([]);
  const [intakeId, setIntakeId] = useState('');
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState(null);
  const [mode, setMode] = useState('original');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listModels().then(result => {
      const available = (result.models || []).filter(model => model.kind === 'video' && model.requiresImageInput !== true && Number(model.maxVideoDuration) >= 1);
      setModels(available);
      if (available[0]) setModelId(available[0].id);
    }).catch(error => message.error(error.message || '读取视频模型失败'));
    const id = new URLSearchParams(window.location.search).get('intake') || '';
    if (id) getBatchFactoryIntake(id).then(result => {
      if (result.intake?.batchId) return onCreated(result.intake.batchId);
      setIntakeId(id);
      setItems(result.intake?.items || []);
    }).catch(error => message.error(error.message || '读取小说获取转入失败'));
  }, []);

  async function create() {
    const model = models.find(entry => Number(entry.id) === Number(modelId));
    if (!items.length) return message.warning('请先从小说获取转入小说');
    if (!model) return message.warning('请选择视频模型');
    setCreating(true);
    try {
      const settings = {
        videoModelId: model.id,
        videoModelVersionId: model.versionId,
        videoModelName: model.name,
        maxVideoDuration: Number(model.maxVideoDuration),
        aspectRatio: '9:16',
        fixedSingleVideo: false,
        prefixMode: 'auto',
        scriptPromptPresetId: DEFAULT_SCRIPT,
        assetPromptPresetId: DEFAULT_ASSET,
        injectCharacterPrompt: true,
        injectScenePrompt: true,
        injectPropPrompt: true,
        subtitlePolicy: 'forbid-auto-dialogue-subtitle'
      };
      const result = await createBatchFactoryBatch({ mode, sourceIntakeId: intakeId, items, settings });
      await updateBatchFactorySettings(result.batch.id, settings);
      const url = new URL(window.location.href);
      url.searchParams.delete('intake');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      await onCreated(result.batch.id);
      message.success('小说已进入批量工厂；请先检查统一设置或单书设置，再点击开始导演');
    } catch (error) {
      message.error(error.message || '创建批次失败');
    } finally { setCreating(false); }
  }

  return <Space direction="vertical" size={14} style={styles.full}>
    <Alert showIcon type="info" message="小说获取 → 独立批量工厂" description="转入后建立小说列表，不自动导演。批量工厂拥有自己独立的提示词、导演、VIDEO、合并与发布流程。" />
    <Card title="小说列表" extra={<Tag>{items.length} 本</Tag>}>
      {items.length ? <List dataSource={items} renderItem={item => <List.Item><List.Item.Meta title={item.title} description={<Space wrap><Tag>{item.bookId}</Tag>{item.platform ? <Tag color="blue">{item.platform}</Tag> : null}</Space>} /></List.Item>} /> : <Empty description="等待小说获取转入" />}
    </Card>
    <Card title="建立批次">
      <Space direction="vertical" style={styles.full}>
        <Typography.Text strong>生产方式</Typography.Text>
        <Segmented value={mode} onChange={setMode} options={[{ value: 'original', label: '原文直转' }, { value: 'viral', label: '爆款开头' }]} />
        <Typography.Text strong>视频模型</Typography.Text>
        <Select value={modelId} onChange={setModelId} style={styles.full} options={models.map(model => ({ value: model.id, label: `${model.name} · 最大 ${model.maxVideoDuration}s` }))} />
        <Button type="primary" loading={creating} onClick={create}>进入批量工厂</Button>
      </Space>
    </Card>
  </Space>;
}

function UnifiedSettings({ open, batch, onClose, onSaved }) {
  const [catalog, setCatalog] = useState({ scriptPrompts: [], assetPrompts: [] });
  const [models, setModels] = useState([]);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      ...batch.settings,
      scriptPromptPresetId: batch.settings?.scriptPromptPresetId || DEFAULT_SCRIPT,
      assetPromptPresetId: batch.settings?.assetPromptPresetId || DEFAULT_ASSET,
      injectCharacterPrompt: batch.settings?.injectCharacterPrompt !== false,
      injectScenePrompt: batch.settings?.injectScenePrompt !== false,
      injectPropPrompt: batch.settings?.injectPropPrompt !== false
    });
    getBatchFactoryPromptCatalog().then(setCatalog).catch(() => {});
    listModels().then(result => setModels((result.models || []).filter(model => model.kind === 'video' && model.requiresImageInput !== true))).catch(() => {});
  }, [open, batch?.id]);

  function patch(key, value) { setForm(current => ({ ...current, [key]: value })); }
  async function save() {
    setSaving(true);
    try {
      await updateBatchFactorySettings(batch.id, form);
      await onSaved();
      message.success('生产统一设置已保存');
      onClose();
    } catch (error) { message.error(error.message || '保存统一设置失败'); }
    finally { setSaving(false); }
  }

  return <Drawer title="生产统一设置" width={540} open={open} onClose={onClose} extra={<Button type="primary" loading={saving} onClick={save}>保存</Button>}>
    <Space direction="vertical" size={14} style={styles.full}>
      <Alert showIcon type="info" message="批次默认值" description="所有没有单独覆盖的小说都会跟随这里。已经单独设置的小说只继承未覆盖的项目。" />
      <div><Typography.Text strong>剧本提示词</Typography.Text><Select style={{ ...styles.full, marginTop: 8 }} value={form.scriptPromptPresetId} onChange={value => patch('scriptPromptPresetId', value)} options={catalog.scriptPrompts.map(item => ({ value: item.id, label: item.name }))} /></div>
      <div><Typography.Text strong>人物场景提示词</Typography.Text><Select style={{ ...styles.full, marginTop: 8 }} value={form.assetPromptPresetId} onChange={value => patch('assetPromptPresetId', value)} options={catalog.assetPrompts.map(item => ({ value: item.id, label: item.name }))} /></div>
      <div><Typography.Text strong>视频模型</Typography.Text><Select style={{ ...styles.full, marginTop: 8 }} value={form.videoModelId} onChange={value => patch('videoModelId', value)} options={models.map(model => ({ value: model.id, label: `${model.name} · 最大 ${model.maxVideoDuration || '—'}s` }))} /></div>
      <div><Typography.Text strong>画幅</Typography.Text><div style={{ marginTop: 8 }}><Segmented value={form.aspectRatio || '9:16'} onChange={value => patch('aspectRatio', value)} options={['9:16', '16:9']} /></div></div>
      <div><Typography.Text strong>VIDEO 时长策略</Typography.Text><div style={{ marginTop: 8 }}><Segmented value={form.fixedSingleVideo === true ? 'fixed' : 'auto'} onChange={value => patch('fixedSingleVideo', value === 'fixed')} options={[{ value: 'auto', label: `AI 自动 · 1-${form.maxVideoDuration || 10}s` }, { value: 'fixed', label: `固定单 VIDEO · ${form.maxVideoDuration || 10}s` }]} /></div></div>
      <div><Typography.Text strong>画面前缀词</Typography.Text><Segmented block style={{ marginTop: 8 }} value={form.prefixMode || 'auto'} onChange={value => patch('prefixMode', value)} options={[{ value: 'auto', label: 'AI 自动' }, { value: 'manual', label: '自定义' }]} />{form.prefixMode === 'manual' ? <Input.TextArea rows={4} style={{ marginTop: 8 }} value={form.customPrefix || ''} onChange={event => patch('customPrefix', event.target.value)} /> : null}</div>
      <div><Typography.Text strong>生成时附加</Typography.Text><Space wrap style={{ marginTop: 8 }}><Switch checked={form.injectCharacterPrompt !== false} onChange={value => patch('injectCharacterPrompt', value)} />人物 <Switch checked={form.injectScenePrompt !== false} onChange={value => patch('injectScenePrompt', value)} />场景 <Switch checked={form.injectPropPrompt !== false} onChange={value => patch('injectPropPrompt', value)} />道具</Space></div>
      <div><Typography.Text strong>画质要求</Typography.Text><Input.TextArea rows={3} style={{ marginTop: 8 }} value={form.quality || ''} onChange={event => patch('quality', event.target.value)} /></div>
      <div><Typography.Text strong>画面限制</Typography.Text><Input.TextArea rows={3} style={{ marginTop: 8 }} value={form.restriction || ''} onChange={event => patch('restriction', event.target.value)} /></div>
      <div><Typography.Text strong>负面提示词</Typography.Text><Input.TextArea rows={4} style={{ marginTop: 8 }} value={form.negative || ''} onChange={event => patch('negative', event.target.value)} /></div>
      <Alert type="info" showIcon message="字幕规则" description="默认禁止自动对白字幕/自动转写字幕，但角色仍可正常说台词并进行嘴型同步。" />
    </Space>
  </Drawer>;
}

function PublishSettings({ open, batch, onClose, onSaved }) {
  const current = batch.publishSettings || {};
  const [count, setCount] = useState(current.jieyaVideoCount ?? 4);
  const [reuse, setReuse] = useState(current.materialReuse === true);
  const [flip, setFlip] = useState(current.horizontalFlip === true);
  const [profileId, setProfileId] = useState(current.profileId || '');
  const [organizationId, setOrganizationId] = useState(current.organizationId || '');

  useEffect(() => {
    if (!open) return;
    setCount(current.jieyaVideoCount ?? 4);
    setReuse(current.materialReuse === true);
    setFlip(current.horizontalFlip === true);
    setProfileId(current.profileId || '');
    setOrganizationId(current.organizationId || '');
  }, [open, batch?.id]);

  async function save() {
    try {
      await updateBatchFactoryPublishSettings(batch.id, { jieyaVideoCount: count, materialReuse: reuse, horizontalFlip: flip, profileId, organizationId });
      await onSaved();
      message.success('发布统一设置已保存');
      onClose();
    } catch (error) { message.error(error.message || '保存发布设置失败'); }
  }

  return <Drawer title="发布统一设置" width={480} open={open} onClose={onClose} extra={<Button type="primary" onClick={save}>保存</Button>}>
    <Space direction="vertical" size={16} style={styles.full}>
      <Space><Typography.Text>解压视频数量</Typography.Text><InputNumber min={0} max={8} value={count} onChange={value => setCount(Number(value || 0))} /></Space>
      <Space><Typography.Text>AI 头部</Typography.Text><Tag color="blue">自定义AI头部</Tag></Space>
      <Space><Switch checked={reuse} onChange={setReuse} /><Typography.Text>素材复用</Typography.Text></Space>
      <Space><Switch checked={flip} onChange={setFlip} /><Typography.Text>水平翻转</Typography.Text></Space>
      <div><Typography.Text strong>121 配置档</Typography.Text><Input style={{ marginTop: 8 }} value={profileId} onChange={event => setProfileId(event.target.value)} placeholder="接通 121 后从账号配置读取/选择" /></div>
      <div><Typography.Text strong>121 组织</Typography.Text><Input style={{ marginTop: 8 }} value={organizationId} onChange={event => setOrganizationId(event.target.value)} placeholder="接通 121 后从账号配置读取/选择" /></div>
      <Alert showIcon type="info" message="发布元数据" description="平台、性别、风格和小说分析配置沿用小说获取已经保存的数据，不在批量工厂重新猜测。" />
    </Space>
  </Drawer>;
}

function MergePanel({ batch, item, status, refreshStatus }) {
  const [strategy, setStrategy] = useState('fixed');
  const [speed, setSpeed] = useState(1.5);
  const [measurement, setMeasurement] = useState(null);
  const [measuring, setMeasuring] = useState(false);
  const [merging, setMerging] = useState(false);
  const [capability, setCapability] = useState(null);
  const videos = item.directorResult?.storyboard || [];
  const states = videos.map((video, index) => ({ video, production: videoProduction(item, index, status) }));
  const mediaIds = states.map(entry => Number(entry.production.media?.id || 0));
  const allReady = mediaIds.length && mediaIds.every(Boolean) && states.every(entry => entry.production.status === 'succeeded');
  const rawDuration = states.every(entry => Number(entry.production.media?.durationMs) > 0)
    ? states.reduce((sum, entry) => sum + Number(entry.production.media.durationMs), 0) / 1000
    : videos.reduce((sum, video) => sum + Number(video.duration_sec || 0), 0);
  const merged = mergedMedia(status);

  useEffect(() => { getBatchFactoryMergeCapability().then(setCapability).catch(() => setCapability({ ready: false, reason: '无法读取合并能力' })); }, []);
  useEffect(() => setMeasurement(null), [item.id]);

  async function measure() {
    const narration = String(batch.mode === 'viral' ? (item.approvedHookScript || item.sourceText) : item.sourceText || '').trim();
    if (!narration) return message.warning('没有测时文本');
    setMeasuring(true);
    try {
      const config = await getConfig();
      const tts = config.tts || {};
      const blob = await textToSpeech({ input: narration, voice: tts.voice || 'zh-CN-XiaoxiaoNeural', style: tts.style || 'general', speed: 1.7, pitch: tts.pitch ?? 10 });
      const target = await audioDuration(blob);
      const ratio = rawDuration / target;
      setMeasurement({ target, ratio, valid: rawDuration >= target && ratio >= 1 && ratio <= 2 });
    } catch (error) { message.error(error.message || 'TTS 测时失败'); }
    finally { setMeasuring(false); }
  }

  async function merge() {
    if (!allReady) return message.warning('请等待这本书全部 VIDEO 完成');
    const finalSpeed = strategy === 'audio' ? measurement?.ratio : speed;
    if (strategy === 'audio' && !measurement?.valid) return message.warning('当前 TTS 测时结果不能直接压缩；不会自动慢放视频');
    setMerging(true);
    try {
      await mergeBatchFactoryVideos({ projectId: Number(item.production.projectId), bookId: String(item.bookId), mediaIds, speed: finalSpeed });
      await refreshStatus();
      message.success(`${item.bookId}.mp4 已合并`);
    } catch (error) { message.error(error.message || '合并失败'); }
    finally { setMerging(false); }
  }

  return <Collapse items={[{ key: 'merge', label: `合并 / ${merged ? '已完成' : '待合并'}`, children: <Space direction="vertical" style={styles.full}>
    <Segmented value={strategy} onChange={setStrategy} options={[{ value: 'fixed', label: '固定倍率' }, { value: 'audio', label: '跟随音频时长' }]} />
    {strategy === 'fixed'
      ? <Select value={speed} onChange={setSpeed} style={{ width: 150 }} options={[1,1.1,1.2,1.3,1.5,1.7,2].map(value => ({ value, label: `${value.toFixed(1)}x` }))} />
      : <Space direction="vertical"><Space wrap><Tag>测时语速 1.7</Tag><Tag>仅测时，不合入音轨</Tag><Button loading={measuring} onClick={measure}>计算音频时长</Button></Space>{measurement ? <Space wrap><Tag>目标 {measurement.target.toFixed(2)}s</Tag><Tag>VIDEO {rawDuration.toFixed(2)}s</Tag><Tag color={measurement.valid ? 'blue' : 'red'}>{measurement.ratio.toFixed(3)}x</Tag></Space> : null}</Space>}
    {capability && !capability.ready ? <Alert type="warning" message={capability.reason} /> : null}
    <Button type="primary" loading={merging} disabled={!allReady || !capability?.ready} onClick={merge}>{merged ? '重新合并' : '合并视频'}</Button>
  </Space> }]} />;
}

export default function BatchFactoryPageV10() {
  const [batch, setBatch] = useState(null);
  const [history, setHistory] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedVideo, setSelectedVideo] = useState('');
  const [statusByProject, setStatusByProject] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookSettingsOpen, setBookSettingsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sourceDraft, setSourceDraft] = useState('');
  const [hookDraft, setHookDraft] = useState('');
  const [assetDrafts, setAssetDrafts] = useState({});
  const [videoDrafts, setVideoDrafts] = useState({});
  const [compiled, setCompiled] = useState({ open: false, loading: false, prompt: '' });
  const [previewUrl, setPreviewUrl] = useState('');
  const previewRef = useRef('');

  const selected = batch?.items?.find(item => item.id === selectedId) || batch?.items?.[0] || null;
  const projectStatus = selected?.production?.projectId ? statusByProject[String(selected.production.projectId)] || null : null;
  const videos = selected?.directorResult?.storyboard || [];
  const currentVideo = videos.find(video => String(video.id) === String(selectedVideo)) || videos[0] || null;
  const currentVideoIndex = currentVideo ? videos.findIndex(video => String(video.id) === String(currentVideo.id)) : -1;
  const currentProduction = currentVideoIndex >= 0 ? videoProduction(selected, currentVideoIndex, projectStatus) : null;

  async function refreshHistory() {
    try { setHistory((await listBatchFactoryBatches()).batches || []); } catch (_) {}
  }

  async function loadBatch(id) {
    const result = await getBatchFactoryBatch(id);
    setBatch(result.batch);
    setSelectedId(current => result.batch.items?.some(item => item.id === current) ? current : (result.batch.items?.[0]?.id || ''));
    return result.batch;
  }

  async function refreshStatus(targetBatch = batch) {
    const ids = projectIds(targetBatch);
    if (!ids.length) return setStatusByProject({});
    try { setStatusByProject((await getBatchFactoryProductionStatus(ids)).projects || {}); } catch (_) {}
  }

  useEffect(() => {
    refreshHistory();
    const intake = new URLSearchParams(window.location.search).get('intake');
    if (!intake) listBatchFactoryBatches().then(result => { if (result.batches?.[0]) loadBatch(result.batches[0].id); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!batch) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const next = await loadBatch(batch.id);
        await refreshStatus(next);
      } catch (_) {}
    }, 2500);
    return () => window.clearInterval(timer);
  }, [batch?.id, projectIds(batch).join(',')]);

  useEffect(() => {
    if (!selected) return;
    setSourceDraft(selected.sourceText || '');
    setHookDraft(selected.approvedHookScript || selected.hookDraft || '');
    setSelectedVideo(String(selected.directorResult?.storyboard?.[0]?.id || ''));
    setAssetDrafts({});
    setVideoDrafts({});
    setPreviewUrl('');
    if (previewRef.current) { URL.revokeObjectURL(previewRef.current); previewRef.current = ''; }
  }, [selected?.id]);

  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  if (!batch) return <div style={styles.page}><Setup onCreated={loadBatch} /></div>;

  const allDirectorReady = batch.items.length > 0 && batch.items.every(item => item.status === 'complete' && item.directorResult?.storyboard?.length);
  const directorActive = batch.items.some(item => ACTIVE_DIRECTOR.has(item.status));
  const hasReview = batch.items.some(item => item.status === 'hook_review');
  const generationStarted = batch.items.some(item => item.production?.projectId);
  const primaryLabel = directorActive ? '导演中…' : hasReview ? '等待爆款开头审核' : allDirectorReady ? (generationStarted ? '继续生成视频' : '生成视频') : '开始导演';

  async function primaryAction() {
    if (directorActive || hasReview) return;
    setBusy(true);
    try {
      if (allDirectorReady) {
        const result = await generateBatchFactoryBatch(batch.id, Number(batch.settings.videoModelId));
        message.success(`已按小说列表顺序处理 ${result.succeededItems || 0} 本；当前已有 ${result.queuedVideos || 0} 个 VIDEO 任务`);
      } else {
        await startBatchFactoryBatch(batch.id);
        message.success('已按小说列表从上到下开始导演');
      }
      const next = await loadBatch(batch.id);
      await refreshStatus(next);
    } catch (error) { message.error(error.message || '操作失败'); }
    finally { setBusy(false); }
  }

  async function saveSource() {
    try {
      await updateBatchFactorySource(batch.id, selected.id, sourceDraft, sourceDraft);
      await loadBatch(batch.id);
      message.success('正文已保存，旧导演结果已失效');
    } catch (error) { message.error(error.message || '保存正文失败'); }
  }

  async function startCurrentDirector() {
    setBusy(true);
    try {
      if (batch.mode === 'viral' && !selected.approvedHookScript) {
        await rewriteBatchFactoryHook(batch.id, selected.id);
        message.success('当前小说已开始生成爆款开头');
      } else {
        await regenerateBatchFactoryDirector(batch.id, selected.id);
        message.success('当前小说已进入导演队列');
      }
      await loadBatch(batch.id);
    } catch (error) { message.error(error.message || '当前小说导演失败'); }
    finally { setBusy(false); }
  }

  async function approveHook() {
    const value = hookDraft.trim();
    if (!value) return message.warning('爆款开头不能为空');
    setBusy(true);
    try {
      await approveBatchFactoryHook(batch.id, selected.id, value);
      await loadBatch(batch.id);
      message.success('爆款开头已锁定，当前小说开始导演');
    } catch (error) { message.error(error.message || '审核失败'); }
    finally { setBusy(false); }
  }

  async function rewriteHook() {
    setBusy(true);
    try {
      await rewriteBatchFactoryHook(batch.id, selected.id);
      await loadBatch(batch.id);
      message.success('已重新生成当前小说爆款开头');
    } catch (error) { message.error(error.message || '重新生成爆款开头失败'); }
    finally { setBusy(false); }
  }

  async function saveDirector(next, text) {
    try {
      await updateBatchFactoryDirectorResult(batch.id, selected.id, next);
      await loadBatch(batch.id);
      message.success(text || '已保存');
    } catch (error) { message.error(error.message || '保存失败'); }
  }

  function editAsset(kind, index, value) {
    const next = clone(selected.directorResult);
    next[kind][index].prompt = value;
    saveDirector(next, '资产提示词已保存');
  }

  function editVideo(video, value) {
    const next = clone(selected.directorResult);
    const target = next.storyboard.find(entry => String(entry.id) === String(video.id));
    target.visualPrompt = value;
    target.video_desc = value;
    saveDirector(next, `${videoLabel(video)} 画面提示词已保存`);
  }

  async function showCompiled(video) {
    setCompiled({ open: true, loading: true, prompt: '' });
    try {
      const result = await compileBatchFactoryVideo(batch.id, selected.id, video.id);
      setCompiled({ open: true, loading: false, prompt: result.payload?.prompt || '' });
    } catch (error) { setCompiled({ open: true, loading: false, prompt: error.message || '编译失败' }); }
  }

  async function generateCurrentBook() {
    setBusy(true);
    try {
      const result = await generateBatchFactoryVideos(batch.id, selected.id, Number(batch.settings.videoModelId));
      const next = await loadBatch(batch.id);
      await refreshStatus(next);
      message.success(result.alreadySubmitted ? '当前小说所有 VIDEO 已经提交过' : '当前小说待生成 VIDEO 已提交');
    } catch (error) { message.error(error.message || '提交失败'); }
    finally { setBusy(false); }
  }

  async function generateCurrentVideo(video = currentVideo) {
    if (!video) return message.warning('请选择 VIDEO');
    setBusy(true);
    try {
      await generateBatchFactoryVideo(batch.id, selected.id, video.id, Number(batch.settings.videoModelId));
      const next = await loadBatch(batch.id);
      await refreshStatus(next);
      setSelectedVideo(String(video.id));
      message.success(`${videoLabel(video)} 已提交；已有结果时会作为一次重生成任务`);
    } catch (error) { message.error(error.message || 'VIDEO 提交失败'); }
    finally { setBusy(false); }
  }

  async function loadPreview() {
    const id = Number(currentProduction?.media?.id || 0);
    if (!id) return message.warning('当前 VIDEO 尚无成品');
    try {
      const blob = await downloadMedia(id);
      const url = URL.createObjectURL(blob);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = url;
      setPreviewUrl(url);
    } catch (error) { message.error(error.message || '加载视频失败'); }
  }

  const hasOverride = selected?.settingsOverride && Object.values(selected.settingsOverride).some(value => value !== '' && value !== 'inherit' && value !== undefined && value !== null);

  return <div style={styles.page}>
    <Space direction="vertical" size={12} style={styles.full}>
      <Card size="small">
        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space wrap>
            <Typography.Title level={4} style={{ margin: 0 }}>批量工厂</Typography.Title>
            <Tag>{batch.items.length} 本</Tag>
            <Tag>{batch.mode === 'viral' ? '爆款开头' : '原文直转'}</Tag>
            <Tag>{batch.settings?.videoModelName}</Tag>
          </Space>
          <Space wrap>
            <Button onClick={() => setSettingsOpen(true)}>生产统一设置</Button>
            <Button onClick={() => setPublishOpen(true)}>发布统一设置</Button>
            <Button type="primary" loading={busy} disabled={directorActive || hasReview} onClick={primaryAction}>{primaryLabel}</Button>
          </Space>
        </Space>
      </Card>

      <div style={styles.columns}>
        <Card title="1. 小说列表" size="small" style={styles.sticky} extra={<Select size="small" value={batch.id} style={{ width: 140 }} onChange={loadBatch} options={history.map(entry => ({ value: entry.id, label: entry.name }))} />}>
          <div style={styles.list}>{batch.items.map((item, index) => {
            const status = item.production?.projectId ? statusByProject[String(item.production.projectId)] : null;
            const [label, color] = itemStatus(item, status);
            const overridden = item.settingsOverride && Object.values(item.settingsOverride).some(value => value !== '' && value !== 'inherit' && value !== undefined && value !== null);
            return <div key={item.id} onClick={() => setSelectedId(item.id)} style={{ ...styles.item, ...(item.id === selected.id ? styles.selected : {}), ...(overridden ? styles.overridden : {}) }}>
              <Space direction="vertical" size={4} style={styles.full}>
                <Space wrap><Typography.Text strong>{String(index + 1).padStart(2, '0')}. {item.title}</Typography.Text><Tag color={color}>{label}</Tag>{overridden ? <Tag color="purple">单书设置</Tag> : null}</Space>
                <Space wrap>{item.bookId ? <Tag>{item.bookId}</Tag> : null}{item.platform ? <Tag color="blue">{item.platform}</Tag> : null}</Space>
              </Space>
            </div>;
          })}</div>
        </Card>

        <Space direction="vertical" size={12} style={styles.full}>
          <Card
            title="2. 当前小说 / 独立导演"
            size="small"
            extra={<Space wrap>{selected.sourceTaskId ? <Tag>来源 #{selected.sourceTaskId}</Tag> : null}{hasOverride ? <Tag color="purple">使用单书覆盖</Tag> : null}<Button size="small" onClick={() => setBookSettingsOpen(true)}>当前小说设置</Button><Button size="small" onClick={saveSource}>保存正文</Button></Space>}
          >
            <Input.TextArea rows={8} value={sourceDraft} onChange={event => setSourceDraft(event.target.value)} />

            {selected.status === 'failed' ? <Alert style={{ marginTop: 10 }} type="error" showIcon message={selected.error || '导演失败'} /> : null}

            {selected.status === 'hook_review' ? <div style={{ ...styles.section, marginTop: 12 }}>
              <Space direction="vertical" size={10} style={styles.full}>
                <Typography.Text strong>爆款开头审核</Typography.Text>
                <Typography.Text type="secondary">审核或修改后锁定。导演第二阶段只能使用这个已批准版本，不得重新改写。</Typography.Text>
                <Input.TextArea rows={7} value={hookDraft} onChange={event => setHookDraft(event.target.value)} />
                <Space><Button loading={busy} onClick={rewriteHook}>重新获取</Button><Button type="primary" loading={busy} onClick={approveHook}>通过并开始导演</Button></Space>
              </Space>
            </div> : null}

            {!selected.directorResult && !ACTIVE_DIRECTOR.has(selected.status) && selected.status !== 'hook_review' ? <Space style={{ marginTop: 12 }}><Button type="primary" loading={busy} onClick={startCurrentDirector}>{batch.mode === 'viral' && !selected.approvedHookScript ? '生成当前小说爆款开头' : '导演当前小说'}</Button></Space> : null}
            {ACTIVE_DIRECTOR.has(selected.status) ? <Alert style={{ marginTop: 12 }} showIcon type="info" message="当前小说正在导演处理中" /> : null}

            {selected.directorResult ? <Space direction="vertical" size={10} style={{ ...styles.full, marginTop: 12 }}>
              <Space wrap>
                <Tag>剧本：{selected.promptVersions?.scriptPrompt?.name || '批量工厂剧本提示词'}</Tag>
                <Tag>资产：{selected.promptVersions?.assetPrompt?.name || '批量工厂人物场景提示词'}</Tag>
                <Button size="small" disabled={Boolean(selected.production?.projectId)} onClick={startCurrentDirector}>重新导演当前小说</Button>
                <Button type="primary" size="small" loading={busy} onClick={generateCurrentBook}>生成 / 继续生成全部 VIDEO</Button>
              </Space>

              <Collapse items={[
                { key: 'characters', label: `人物 ${selected.directorResult.characters?.length || 0}`, children: <Space direction="vertical" style={styles.full}>{(selected.directorResult.characters || []).map((asset, index) => <Card size="small" key={`${asset.name}-${index}`} title={asset.name}><Input.TextArea rows={4} value={assetDrafts[`characters-${index}`] ?? asset.prompt} onChange={event => setAssetDrafts(current => ({ ...current, [`characters-${index}`]: event.target.value }))} /><Button size="small" style={{ marginTop: 8 }} onClick={() => editAsset('characters', index, assetDrafts[`characters-${index}`] ?? asset.prompt)}>保存</Button></Card>)}</Space> },
                { key: 'scenes', label: `场景 ${selected.directorResult.scenes?.length || 0}`, children: <Space direction="vertical" style={styles.full}>{(selected.directorResult.scenes || []).map((asset, index) => <Card size="small" key={`${asset.name}-${index}`} title={asset.name}><Input.TextArea rows={4} value={assetDrafts[`scenes-${index}`] ?? asset.prompt} onChange={event => setAssetDrafts(current => ({ ...current, [`scenes-${index}`]: event.target.value }))} /><Button size="small" style={{ marginTop: 8 }} onClick={() => editAsset('scenes', index, assetDrafts[`scenes-${index}`] ?? asset.prompt)}>保存</Button></Card>)}</Space> },
                { key: 'props', label: `道具 ${selected.directorResult.props?.length || 0}`, children: <Space direction="vertical" style={styles.full}>{(selected.directorResult.props || []).map((asset, index) => <Card size="small" key={`${asset.name}-${index}`} title={asset.name}><Input.TextArea rows={4} value={assetDrafts[`props-${index}`] ?? asset.prompt} onChange={event => setAssetDrafts(current => ({ ...current, [`props-${index}`]: event.target.value }))} /><Button size="small" style={{ marginTop: 8 }} onClick={() => editAsset('props', index, assetDrafts[`props-${index}`] ?? asset.prompt)}>保存</Button></Card>)}</Space> }
              ]} />

              {videos.length ? <Card size="small" title="VIDEO 画面提示词"><Tabs items={videos.map(video => ({
                key: String(video.id),
                label: videoLabel(video),
                children: <Space direction="vertical" style={styles.full}>
                  <Input.TextArea rows={7} value={videoDrafts[String(video.id)] ?? visualPrompt(video)} onChange={event => setVideoDrafts(current => ({ ...current, [String(video.id)]: event.target.value }))} />
                  <Space wrap>
                    <Button onClick={() => editVideo(video, videoDrafts[String(video.id)] ?? visualPrompt(video))}>保存修改</Button>
                    <Button onClick={() => showCompiled(video)}>本次提交预览</Button>
                    <Button type="primary" loading={busy} onClick={() => generateCurrentVideo(video)}>生成 / 重生成此 VIDEO</Button>
                  </Space>
                </Space>
              }))} /></Card> : null}
            </Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前小说尚未生成导演结果" />}
          </Card>
        </Space>

        <Space direction="vertical" size={12} style={styles.full}>
          <Card title="3. VIDEO" size="small" extra={<Tag>跟随当前小说</Tag>}>
            {videos.length ? <>
              <Segmented block value={String(currentVideo?.id || '')} onChange={value => { setSelectedVideo(String(value)); setPreviewUrl(''); }} options={videos.map(video => ({ value: String(video.id), label: videoLabel(video) }))} />
              <Space direction="vertical" style={{ ...styles.full, marginTop: 12 }}>
                <Space wrap><Tag>{currentVideo?.duration_sec || 0}s</Tag><Tag>{currentProduction?.status || 'draft'}</Tag><Tag>人物 {currentVideo?.characters?.length || 0}</Tag><Tag>场景 {currentVideo?.scene ? 1 : 0}</Tag><Tag>道具 {currentVideo?.props?.length || 0}</Tag></Space>
                <Space wrap><Button type="primary" loading={busy} onClick={() => generateCurrentVideo()}>生成 / 重生成当前 VIDEO</Button><Button onClick={() => showCompiled(currentVideo)}>本次提交预览</Button></Space>
                <div style={styles.player}>{previewUrl ? <video controls src={previewUrl} style={{ width: '100%', maxHeight: 520 }} /> : <Button disabled={!currentProduction?.media?.id} onClick={loadPreview}>加载当前 VIDEO</Button>}</div>
                {currentProduction?.error ? <Alert type="error" message={currentProduction.error} /> : null}
              </Space>
            </> : <Empty description="当前小说还没有 VIDEO" />}
          </Card>

          {selected.production?.projectId ? <Card title="4. 合并成品 / 发布" size="small">
            <MergePanel batch={batch} item={selected} status={projectStatus} refreshStatus={() => refreshStatus(batch)} />
            <Divider />
            <Space direction="vertical" style={styles.full}>
              <Space wrap><Tag>{selected.bookId}.mp4</Tag><Tag>{selected.bookId}.txt</Tag></Space>
              <Button type="primary" disabled>发布到 121</Button>
              <Typography.Text type="secondary">121 真发布桥接下一阶段接入。没有真实会话、组织和配置档之前不做假上传；发布包固定使用当前书的 MP4 + TXT，并继承小说获取的平台/性别/风格元数据。</Typography.Text>
            </Space>
          </Card> : <Card title="4. 合并成品 / 发布" size="small"><Empty description="生成 VIDEO 后可在这里合并并发布" /></Card>}
        </Space>
      </div>
    </Space>

    <UnifiedSettings open={settingsOpen} batch={batch} onClose={() => setSettingsOpen(false)} onSaved={() => loadBatch(batch.id)} />
    <BatchFactoryBookSettings open={bookSettingsOpen} batch={batch} item={selected} onClose={() => setBookSettingsOpen(false)} onSaved={() => loadBatch(batch.id)} />
    <PublishSettings open={publishOpen} batch={batch} onClose={() => setPublishOpen(false)} onSaved={() => loadBatch(batch.id)} />
    <Modal open={compiled.open} width={900} title="本次提交 Prompt 预览" footer={<Button onClick={() => setCompiled({ open: false, loading: false, prompt: '' })}>关闭</Button>} onCancel={() => setCompiled({ open: false, loading: false, prompt: '' })}>{compiled.loading ? <Spin /> : <Input.TextArea readOnly rows={24} value={compiled.prompt} />}</Modal>
  </div>;
}