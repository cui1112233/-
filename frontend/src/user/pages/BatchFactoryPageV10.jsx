import {
  Alert,
  Button,
  Card,
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
  Tooltip,
  Typography,
  message
} from 'antd';
import { LeftOutlined, RightOutlined, SettingOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  getBatchFactoryWorkbench,
  listBatchFactoryBatches,
  mergeBatchFactoryVideos,
  regenerateBatchFactoryAsset,
  regenerateBatchFactoryDirector,
  regenerateBatchFactoryVideo,
  rewriteBatchFactoryHook,
  startBatchFactoryBatch,
  updateBatchFactoryDirectorResult,
  updateBatchFactoryItemOverrides,
  updateBatchFactoryPublishSettings,
  updateBatchFactorySettings,
  updateBatchFactorySource
} from '../../shared/api/batchFactory';
import { getConfig } from '../../shared/api/config';
import { downloadMedia, listModels } from '../../shared/api/shuihuoProduction';
import { textToSpeech } from '../../shared/api/tts';

const MERGE_SOURCE = 'batch_merge';
const ACTIVE_DIRECTOR = new Set(['queued_hook', 'hook_generating', 'queued_director', 'director_generating']);
const DEFAULT_SCRIPT = 'standard-short-drama';
const DEFAULT_ASSET = 'standard-asset-extraction';

const styles = {
  page: { width: '100%', minWidth: 0 },
  columns: { display: 'grid', gridTemplateColumns: '250px minmax(680px,1fr) minmax(340px,420px)', gap: 12, alignItems: 'start' },
  list: { maxHeight: '72vh', overflowY: 'auto' },
  item: { padding: 10, borderRadius: 10, cursor: 'pointer', border: '1px solid rgba(127,127,127,.18)', marginBottom: 8, transition: 'transform .16s ease, box-shadow .16s ease' },
  selected: { transform: 'translateY(-2px)', boxShadow: '0 8px 24px rgba(0,0,0,.10)', borderColor: '#1677ff' },
  currentGrid: { display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 10 },
  actionCard: { cursor: 'pointer', minHeight: 150, height: '100%' },
  full: { width: '100%' },
  player: { minHeight: 250, background: '#050505', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  modalTwo: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  footerNav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  muted: { color: 'rgba(0,0,0,.45)' }
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function visualPrompt(video) { return String(video?.visualPrompt || video?.visual_prompt || video?.video_desc || video?.videoDesc || '').trim(); }
function projectIds(batch) { return [...new Set((batch?.items || []).map(item => Number(item.production?.projectId)).filter(id => id > 0))]; }
function mergedMedia(status) { return [...(status?.media || [])].reverse().find(item => item.source === MERGE_SOURCE) || null; }
function mapProjects(projects) { return Object.fromEntries((Array.isArray(projects) ? projects : []).map(project => [String(project.projectId), project])); }
function latestSubmission(item, video) { return [...(item?.productionResults || [])].reverse().find(result => String(result.videoId || result.index) === String(video?.id)) || null; }

function videoProduction(item, video, status) {
  if (!video) return { status: 'draft', media: null, task: null, stale: false };
  const submission = latestSubmission(item, video);
  const segmentId = Number(submission?.segmentId || submission?.task?.segmentId || 0);
  const taskId = Number(submission?.task?.id || 0);
  const task = [...(status?.tasks || [])].reverse().find(entry => (taskId && Number(entry.id) === taskId) || (segmentId && Number(entry.segmentId) === segmentId)) || submission?.task || null;
  const media = [...(status?.media || [])].reverse().find(entry => entry.source !== MERGE_SOURCE && ((task?.id && Number(entry.taskId) === Number(task.id)) || (segmentId && Number(entry.segmentId) === segmentId))) || null;
  const stale = Boolean(media) && Number(submission?.promptRevision || 0) !== Number(video.promptRevision || 1);
  return {
    status: stale ? 'stale' : media ? 'succeeded' : (task?.status || (submission ? 'queued' : 'draft')),
    media,
    task,
    stale,
    error: task?.errorMessage || submission?.error || ''
  };
}

function itemStatus(item, status) {
  if (item?.status === 'failed' || item?.productionSubmissionError) return ['异常', 'red'];
  if (ACTIVE_DIRECTOR.has(item?.status)) return ['导演中', 'processing'];
  if (item?.status === 'hook_review') return ['待审核', 'gold'];
  if (!item?.directorResult?.storyboard?.length) return ['待导演', 'default'];
  const states = item.directorResult.storyboard.map(video => videoProduction(item, video, status).status);
  if (states.some(state => state === 'failed' || state === 'cancelled')) return ['视频异常', 'red'];
  if (states.some(state => state === 'stale')) return ['有旧版视频', 'orange'];
  if (states.some(state => state === 'running' || state === 'queued')) return ['生成中', 'processing'];
  if (states.length && states.every(state => state === 'succeeded')) return [mergedMedia(status) ? '已合并' : '视频完成', mergedMedia(status) ? 'green' : 'cyan'];
  return ['已导演', 'blue'];
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
        productionMode: mode,
        productionLineCount: 10,
        hookReviewMode: 'auto',
        videoModelId: model.id,
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
      const url = new URL(window.location.href);
      url.searchParams.delete('intake');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      onCreated(result.batch.id);
      message.success('全部小说已进入批量工厂；完整 TXT 保留，视频制作默认取前 10 个有效行');
    } catch (error) {
      message.error(error.message || '创建批次失败');
    } finally { setCreating(false); }
  }

  return <Space direction="vertical" size={14} style={styles.full}>
    <Alert showIcon type="info" message="小说获取 → 批量工厂" description={`当前交接 ${items.length} 本。建立批次不会自动导演；默认只取每本完整 TXT 的前 10 个有效行做视频，发布时仍使用完整 TXT。`} />
    <Card title="待转入小说" extra={<Tag>{items.length} 本</Tag>}>
      {items.length ? <List dataSource={items} renderItem={item => <List.Item><List.Item.Meta title={item.title} description={<Space wrap><Tag>{item.bookId}</Tag>{item.platform ? <Tag color="blue">{item.platform}</Tag> : null}</Space>} /></List.Item>} /> : <Empty description="等待小说获取转入" />}
    </Card>
    <Card title="建立批次">
      <Space direction="vertical" style={styles.full}>
        <Segmented block value={mode} onChange={setMode} options={[{ value: 'original', label: '原文直转' }, { value: 'viral', label: '爆款开头' }]} />
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
    setForm({ ...batch.settings, productionLineCount: batch.settings?.productionLineCount ?? 10, productionMode: batch.settings?.productionMode || batch.mode || 'original', hookReviewMode: batch.settings?.hookReviewMode || 'auto' });
    getBatchFactoryPromptCatalog().then(setCatalog).catch(() => {});
    listModels().then(result => setModels((result.models || []).filter(model => model.kind === 'video' && model.requiresImageInput !== true))).catch(() => {});
  }, [open, batch?.id]);
  function patch(key, value) { setForm(current => ({ ...current, [key]: value })); }
  function chooseModel(value) {
    const model = models.find(entry => Number(entry.id) === Number(value));
    setForm(current => ({ ...current, videoModelId: value, maxVideoDuration: Math.min(Number(current.maxVideoDuration || model?.maxVideoDuration || 10), Number(model?.maxVideoDuration || 10)) }));
  }
  async function save() {
    setSaving(true);
    try {
      await updateBatchFactorySettings(batch.id, form);
      message.success('生产统一设置已保存；只影响仍继承统一设置的小说');
      await onSaved();
      onClose();
    } catch (error) { message.error(error.message || '保存统一设置失败'); }
    finally { setSaving(false); }
  }
  const selectedModel = models.find(model => Number(model.id) === Number(form.videoModelId));
  return <Drawer title="生产统一设置" width={560} open={open} onClose={onClose} extra={<Button type="primary" loading={saving} onClick={save}>保存并应用</Button>}>
    <Space direction="vertical" size={18} style={styles.full}>
      <Alert type="info" showIcon message={`应用于当前批次 · ${batch.items.length} 本`} description="当前小说或 VIDEO 已做单独覆盖的字段不会被统一设置静默覆盖。制作行数只影响视频，不会截断最终上传的完整 TXT。" />
      <div><Typography.Text strong>视频制作取文行数</Typography.Text><Space style={{ marginTop: 8 }}><InputNumber min={0} max={500} value={form.productionLineCount ?? 10} onChange={value => patch('productionLineCount', Number(value ?? 10))} /><Typography.Text type="secondary">0 = 全部；默认 10 个有效行，空行不计数</Typography.Text></Space></div>
      <div><Typography.Text strong>生产方式</Typography.Text><Segmented block style={{ marginTop: 8 }} value={form.productionMode || 'original'} onChange={value => patch('productionMode', value)} options={[{ value: 'original', label: '原文直转' }, { value: 'viral', label: '爆款开头' }]} /></div>
      {form.productionMode === 'viral' ? <div><Typography.Text strong>爆款开头审核</Typography.Text><Segmented block style={{ marginTop: 8 }} value={form.hookReviewMode || 'auto'} onChange={value => patch('hookReviewMode', value)} options={[{ value: 'auto', label: '自动通过并继续' }, { value: 'manual', label: '人工审核' }]} /></div> : null}
      <div><Typography.Text strong>剧本提示词</Typography.Text><Select style={{ ...styles.full, marginTop: 8 }} value={form.scriptPromptPresetId || DEFAULT_SCRIPT} onChange={value => patch('scriptPromptPresetId', value)} options={catalog.scriptPrompts.map(item => ({ value: item.id, label: `${item.name} · v${item.version}` }))} /></div>
      <div><Typography.Text strong>人物场景提示词</Typography.Text><Select style={{ ...styles.full, marginTop: 8 }} value={form.assetPromptPresetId || DEFAULT_ASSET} onChange={value => patch('assetPromptPresetId', value)} options={catalog.assetPrompts.map(item => ({ value: item.id, label: `${item.name} · v${item.version}` }))} /></div>
      <Divider style={{ margin: 0 }} />
      <div><Typography.Text strong>视频模型</Typography.Text><Select style={{ ...styles.full, marginTop: 8 }} value={form.videoModelId} onChange={chooseModel} options={models.map(model => ({ value: model.id, label: `${model.name} · 最大 ${model.maxVideoDuration || '—'}s` }))} /></div>
      <div><Typography.Text strong>单 VIDEO 最大秒数</Typography.Text><InputNumber style={{ marginTop: 8, width: '100%' }} min={1} max={Number(selectedModel?.maxVideoDuration || form.videoModelMaxDuration || 60)} value={form.maxVideoDuration || 10} onChange={value => patch('maxVideoDuration', Number(value || 1))} /></div>
      <div><Typography.Text strong>画幅</Typography.Text><Segmented style={{ marginTop: 8 }} value={form.aspectRatio || '9:16'} onChange={value => patch('aspectRatio', value)} options={['9:16', '16:9']} /></div>
      <Space wrap><Switch checked={form.injectCharacterPrompt !== false} onChange={value => patch('injectCharacterPrompt', value)} />人物一致性 <Switch checked={form.injectScenePrompt !== false} onChange={value => patch('injectScenePrompt', value)} />场景一致性 <Switch checked={form.injectPropPrompt !== false} onChange={value => patch('injectPropPrompt', value)} />道具一致性</Space>
      <div><Typography.Text strong>画面前缀词</Typography.Text><Input.TextArea rows={3} style={{ marginTop: 8 }} value={form.customPrefix || ''} onChange={event => patch('customPrefix', event.target.value)} /></div>
      <div><Typography.Text strong>画质要求</Typography.Text><Input.TextArea rows={3} style={{ marginTop: 8 }} value={form.quality || ''} onChange={event => patch('quality', event.target.value)} /></div>
      <div><Typography.Text strong>画面限制</Typography.Text><Input.TextArea rows={3} style={{ marginTop: 8 }} value={form.restriction || ''} onChange={event => patch('restriction', event.target.value)} /></div>
      <div><Typography.Text strong>负面提示词</Typography.Text><Input.TextArea rows={4} style={{ marginTop: 8 }} value={form.negative || ''} onChange={event => patch('negative', event.target.value)} /></div>
      <div><Typography.Text strong>字幕 / 文字</Typography.Text><Select style={{ ...styles.full, marginTop: 8 }} value={form.subtitlePolicy || 'forbid-auto-dialogue-subtitle'} onChange={value => patch('subtitlePolicy', value)} options={[{ value: 'forbid-auto-dialogue-subtitle', label: '禁止自动对白字幕（推荐）' }, { value: 'allow', label: '允许模型自行处理' }]} /></div>
    </Space>
  </Drawer>;
}

function PublishSettings({ open, batch, onClose, onSaved }) {
  const [form, setForm] = useState({});
  useEffect(() => { if (open) setForm({ jieyaVideoCount: 4, materialReuse: false, horizontalFlip: false, ...(batch.publishSettings || {}) }); }, [open, batch?.id]);
  function patch(key, value) { setForm(current => ({ ...current, [key]: value })); }
  async function save() {
    try { await updateBatchFactoryPublishSettings(batch.id, form); await onSaved(); message.success('发布统一设置已保存'); onClose(); }
    catch (error) { message.error(error.message || '保存发布设置失败'); }
  }
  return <Drawer title="发布统一设置" width={480} open={open} onClose={onClose} extra={<Button type="primary" onClick={save}>保存</Button>}>
    <Space direction="vertical" size={16} style={styles.full}>
      <Space><Typography.Text>解压视频数量</Typography.Text><InputNumber min={0} max={8} value={form.jieyaVideoCount ?? 4} onChange={value => patch('jieyaVideoCount', Number(value || 0))} /></Space>
      <Space><Typography.Text>AI头部</Typography.Text><Tag color="blue">自定义AI头部</Tag></Space>
      <Space><Switch checked={form.materialReuse === true} onChange={value => patch('materialReuse', value)} /><Typography.Text>素材复用</Typography.Text></Space>
      <Space><Switch checked={form.horizontalFlip === true} onChange={value => patch('horizontalFlip', value)} /><Typography.Text>水平翻转</Typography.Text></Space>
      <Input placeholder="121 配置 ID" value={form.configId || ''} onChange={event => patch('configId', event.target.value)} />
      <Input placeholder="121 档案 / profile ID" value={form.profileId || ''} onChange={event => patch('profileId', event.target.value)} />
      <Input placeholder="组织归属 ID" value={form.organizationId || ''} onChange={event => patch('organizationId', event.target.value)} />
    </Space>
  </Drawer>;
}

function MergePanel({ batch, item, status, refreshStatus }) {
  const [strategy, setStrategy] = useState('fixed');
  const [speed, setSpeed] = useState(1);
  const [measurement, setMeasurement] = useState(null);
  const [measuring, setMeasuring] = useState(false);
  const [merging, setMerging] = useState(false);
  const [capability, setCapability] = useState(null);
  const videos = item.directorResult?.storyboard || [];
  const states = videos.map(video => ({ video, production: videoProduction(item, video, status) }));
  const mediaIds = states.map(entry => Number(entry.production.media?.id || 0));
  const allReady = mediaIds.length && mediaIds.every(Boolean) && states.every(entry => entry.production.status === 'succeeded');
  const rawDuration = states.every(entry => Number(entry.production.media?.durationMs) > 0)
    ? states.reduce((sum, entry) => sum + Number(entry.production.media.durationMs), 0) / 1000
    : videos.reduce((sum, video) => sum + Number(video.duration_sec || 0), 0);
  const merged = mergedMedia(status);
  useEffect(() => { getBatchFactoryMergeCapability().then(setCapability).catch(() => setCapability({ ready: false, reason: '无法读取合并能力' })); }, []);
  useEffect(() => setMeasurement(null), [item.id]);
  async function measure() {
    const narration = String(item.productionTextOverride || item.sourceText || '').trim();
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
    if (!allReady) return message.warning('请等待当前小说全部 VIDEO 完成且没有旧版分镜');
    const finalSpeed = strategy === 'audio' ? measurement?.ratio : speed;
    if (strategy === 'audio' && !measurement?.valid) return message.warning('当前测时结果不能直接压缩；不会自动慢放视频');
    setMerging(true);
    try { await mergeBatchFactoryVideos({ projectId: Number(item.production.projectId), bookId: String(item.bookId), mediaIds, speed: finalSpeed }); await refreshStatus(); message.success(`${item.bookId}.mp4 已合并`); }
    catch (error) { message.error(error.message || '合并失败'); }
    finally { setMerging(false); }
  }
  return <Space direction="vertical" style={styles.full}>
    <Segmented value={strategy} onChange={setStrategy} options={[{ value: 'fixed', label: '固定倍率' }, { value: 'audio', label: '跟随音频时长' }]} />
    {strategy === 'fixed' ? <Select value={speed} onChange={setSpeed} style={{ width: 150 }} options={[1,1.1,1.2,1.3,1.5,1.7,2].map(value => ({ value, label: `${value.toFixed(1)}x` }))} /> : <Space direction="vertical"><Space wrap><Tag>测时语速 1.7</Tag><Tag>只测时，不混入音轨</Tag><Button loading={measuring} onClick={measure}>计算音频时长</Button></Space>{measurement ? <Space wrap><Tag>目标 {measurement.target.toFixed(2)}s</Tag><Tag>VIDEO {rawDuration.toFixed(2)}s</Tag><Tag color={measurement.valid ? 'blue' : 'red'}>{measurement.ratio.toFixed(3)}x</Tag></Space> : null}</Space>}
    {capability && !capability.ready ? <Alert type="warning" message={capability.reason} /> : null}
    <Button type="primary" loading={merging} disabled={!allReady || !capability?.ready} onClick={merge}>{merged ? '重新合并' : '合并视频'}</Button>
  </Space>;
}

export default function BatchFactoryPageV10() {
  const [batch, setBatch] = useState(null);
  const [history, setHistory] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [statusByProject, setStatusByProject] = useState({});
  const [workbench, setWorkbench] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [contentOpen, setContentOpen] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);
  const [storyboardOpen, setStoryboardOpen] = useState(false);
  const [constraintOpen, setConstraintOpen] = useState(false);
  const [bookSettingsOpen, setBookSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [productionDraft, setProductionDraft] = useState('');
  const [hookDraft, setHookDraft] = useState('');
  const [assetKind, setAssetKind] = useState('characters');
  const [assetIndex, setAssetIndex] = useState(0);
  const [assetDraft, setAssetDraft] = useState('');
  const [storyDraft, setStoryDraft] = useState('');
  const [constraintDraft, setConstraintDraft] = useState({});
  const [bookDraft, setBookDraft] = useState({});
  const [compiled, setCompiled] = useState({ open: false, loading: false, prompt: '' });
  const [previewUrl, setPreviewUrl] = useState('');
  const previewRef = useRef('');

  const selected = batch?.items?.find(item => item.id === selectedId) || batch?.items?.[0] || null;
  const projectStatus = selected?.production?.projectId ? statusByProject[String(selected.production.projectId)] || null : null;
  const videos = selected?.directorResult?.storyboard || [];
  const currentVideo = videos.find(video => String(video.id) === String(selectedVideoId)) || videos[0] || null;
  const currentVideoIndex = currentVideo ? videos.findIndex(video => String(video.id) === String(currentVideo.id)) : -1;
  const currentProduction = currentVideo ? videoProduction(selected, currentVideo, projectStatus) : null;
  const currentAssets = selected?.directorResult?.[assetKind] || [];
  const currentAsset = currentAssets[assetIndex] || null;

  async function refreshHistory() { try { setHistory((await listBatchFactoryBatches()).batches || []); } catch (_) {} }
  async function loadBatch(id) {
    const result = await getBatchFactoryBatch(id);
    setBatch(result.batch);
    setSelectedId(current => result.batch.items?.some(item => item.id === current) ? current : (result.batch.items?.[0]?.id || ''));
  }
  async function loadWorkbench(itemId = selected?.id) {
    if (!batch?.id || !itemId) return;
    try {
      const result = await getBatchFactoryWorkbench(batch.id, itemId);
      setWorkbench(result);
      setProductionDraft(result.productionText || '');
      setBookDraft(result.effectiveSettings || {});
      setConstraintDraft(result.effectiveSettings || {});
    } catch (_) {}
  }
  async function refreshStatus() {
    const ids = projectIds(batch);
    if (!ids.length) return setStatusByProject({});
    try { setStatusByProject(mapProjects((await getBatchFactoryProductionStatus(ids)).projects)); } catch (_) {}
  }

  useEffect(() => {
    refreshHistory();
    const intake = new URLSearchParams(window.location.search).get('intake');
    if (!intake) listBatchFactoryBatches().then(result => { if (result.batches?.[0]) loadBatch(result.batches[0].id); }).catch(() => {});
  }, []);
  useEffect(() => { if (!batch) return; const timer = window.setInterval(() => { loadBatch(batch.id).catch(() => {}); refreshStatus(); }, 2500); return () => clearInterval(timer); }, [batch?.id, projectIds(batch).join(',')]);
  useEffect(() => { if (!selected) return; setSelectedVideoId(String(selected.directorResult?.storyboard?.[0]?.id || '')); setHookDraft(selected.hookDraft || ''); setPreviewUrl(''); loadWorkbench(selected.id); if (previewRef.current) { URL.revokeObjectURL(previewRef.current); previewRef.current = ''; } }, [selected?.id]);
  useEffect(() => { if (storyboardOpen && currentVideo) setStoryDraft(visualPrompt(currentVideo)); }, [storyboardOpen, currentVideo?.id]);
  useEffect(() => { if (assetOpen && currentAsset) setAssetDraft(currentAsset.prompt || ''); }, [assetOpen, assetKind, assetIndex, currentAsset?.prompt]);
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  if (!batch) return <div style={styles.page}><Setup onCreated={loadBatch} /></div>;

  const directorActive = batch.items.some(item => ACTIVE_DIRECTOR.has(item.status));
  const hasReview = batch.items.some(item => item.status === 'hook_review');
  const allDirectorReady = batch.items.length > 0 && batch.items.every(item => item.status === 'complete' && item.directorResult?.storyboard?.length);
  const pendingDirector = batch.items.some(item => ['pending', 'failed'].includes(item.status));
  const primaryLabel = directorActive ? '导演中…' : pendingDirector ? '开始导演' : allDirectorReady ? '统一生成视频' : hasReview ? '等待爆款审核' : '继续导演';

  async function primaryAction() {
    if (directorActive || (hasReview && !pendingDirector && !allDirectorReady)) return;
    setBusy(true);
    try {
      if (allDirectorReady) {
        const result = await generateBatchFactoryBatch(batch.id);
        message.success(`已按小说顺序提交 ${result.succeededItems || 0} 本 / ${result.queuedVideos || 0} 个 VIDEO`);
      } else {
        await startBatchFactoryBatch(batch.id);
        message.success('已按小说列表从上到下串行开始导演');
      }
      await loadBatch(batch.id); await refreshStatus();
    } catch (error) { message.error(error.message || '操作失败'); }
    finally { setBusy(false); }
  }

  async function saveProductionText() {
    try { await updateBatchFactorySource(batch.id, selected.id, productionDraft); await loadBatch(batch.id); await loadWorkbench(selected.id); message.success('视频制作内容已保存；完整 TXT 未修改'); setContentOpen(false); }
    catch (error) { message.error(error.message || '保存制作内容失败'); }
  }
  async function restoreProductionText() {
    try { await updateBatchFactorySource(batch.id, selected.id, '', { clearOverride: true }); await loadBatch(batch.id); await loadWorkbench(selected.id); message.success('已恢复按制作行数从完整 TXT 自动取文'); }
    catch (error) { message.error(error.message || '恢复失败'); }
  }
  async function saveAsset() {
    if (!currentAsset) return;
    const next = clone(selected.directorResult);
    next[assetKind][assetIndex].prompt = assetDraft;
    try { await updateBatchFactoryDirectorResult(batch.id, selected.id, next); await loadBatch(batch.id); message.success('资产提示词已保存'); }
    catch (error) { message.error(error.message || '保存失败'); }
  }
  async function regenerateAsset() {
    try { await regenerateBatchFactoryAsset(batch.id, selected.id, assetKind, assetIndex); await loadBatch(batch.id); message.success('当前资产已重生'); }
    catch (error) { message.error(error.message || '资产重生失败'); }
  }
  async function saveStoryboard() {
    if (!currentVideo) return;
    const next = clone(selected.directorResult);
    const target = next.storyboard.find(video => String(video.id) === String(currentVideo.id));
    target.visualPrompt = storyDraft; target.video_desc = storyDraft;
    try { await updateBatchFactoryDirectorResult(batch.id, selected.id, next); await loadBatch(batch.id); message.success(`VIDEO ${currentVideo.id} 分镜已保存`); }
    catch (error) { message.error(error.message || '保存分镜失败'); }
  }
  async function regenerateStoryboard() {
    try { await regenerateBatchFactoryVideo(batch.id, selected.id, currentVideo.id); await loadBatch(batch.id); message.success(`VIDEO ${currentVideo.id} 已重生`); }
    catch (error) { message.error(error.message || '分镜重生失败'); }
  }
  async function generateCurrentVideo() {
    try { await generateBatchFactoryVideo(batch.id, selected.id, currentVideo.id); await loadBatch(batch.id); await refreshStatus(); message.success(`VIDEO ${currentVideo.id} 已提交生成`); }
    catch (error) { message.error(error.message || 'VIDEO 生成失败'); }
  }
  async function generateCurrentBook() {
    setBusy(true);
    try { await generateBatchFactoryVideos(batch.id, selected.id); await loadBatch(batch.id); await refreshStatus(); message.success('当前小说待生成 / 已过期 VIDEO 已按顺序提交'); }
    catch (error) { message.error(error.message || '提交失败'); }
    finally { setBusy(false); }
  }
  async function saveBookSettings() {
    try { await updateBatchFactoryItemOverrides(batch.id, selected.id, bookDraft); await loadBatch(batch.id); await loadWorkbench(selected.id); message.success('当前小说设置已保存'); setBookSettingsOpen(false); }
    catch (error) { message.error(error.message || '保存当前小说设置失败'); }
  }
  async function resetBookSettings() {
    const reset = {};
    Object.keys(bookDraft || {}).forEach(key => { reset[key] = null; });
    try { await updateBatchFactoryItemOverrides(batch.id, selected.id, reset); await loadBatch(batch.id); await loadWorkbench(selected.id); message.success('当前小说已恢复继承统一设置'); }
    catch (error) { message.error(error.message || '恢复失败'); }
  }
  async function saveConstraints() {
    const fields = ['prefixMode','customPrefix','quality','restriction','negative','subtitlePolicy','injectCharacterPrompt','injectScenePrompt','injectPropPrompt'];
    const settings = Object.fromEntries(fields.map(key => [key, constraintDraft[key]]));
    try { await updateBatchFactoryItemOverrides(batch.id, selected.id, settings); await loadBatch(batch.id); await loadWorkbench(selected.id); message.success('当前小说生成约束已保存'); setConstraintOpen(false); }
    catch (error) { message.error(error.message || '保存生成约束失败'); }
  }
  async function showCompiled() {
    setCompiled({ open: true, loading: true, prompt: '' });
    try { const result = await compileBatchFactoryVideo(batch.id, selected.id, currentVideo.id); setCompiled({ open: true, loading: false, prompt: result.payload?.prompt || '' }); }
    catch (error) { setCompiled({ open: true, loading: false, prompt: error.message || '编译失败' }); }
  }
  async function loadPreview() {
    const id = Number(currentProduction?.media?.id || 0);
    if (!id) return message.warning('当前 VIDEO 尚无成品');
    try { const blob = await downloadMedia(id); const url = URL.createObjectURL(blob); if (previewRef.current) URL.revokeObjectURL(previewRef.current); previewRef.current = url; setPreviewUrl(url); }
    catch (error) { message.error(error.message || '加载视频失败'); }
  }

  function openAsset() { setAssetKind('characters'); setAssetIndex(0); setAssetOpen(true); }
  function openStoryboard() { setSelectedVideoId(String(videos[0]?.id || '')); setStoryboardOpen(true); }
  function moveVideo(delta) { const next = Math.max(0, Math.min(videos.length - 1, currentVideoIndex + delta)); setSelectedVideoId(String(videos[next]?.id || '')); }

  return <div style={styles.page}><Space direction="vertical" size={12} style={styles.full}>
    <Card size="small">
      <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
        <Space wrap><Typography.Title level={4} style={{ margin: 0 }}>批量工厂</Typography.Title><Tag>{batch.items.length} 本</Tag><Tag>默认 {batch.settings?.productionLineCount ?? 10} 行制作</Tag></Space>
        <Space wrap><Button onClick={() => setSettingsOpen(true)}>生产统一设置</Button><Button onClick={() => setPublishOpen(true)}>发布统一设置</Button><Button type="primary" loading={busy} disabled={directorActive} onClick={primaryAction}>{primaryLabel}</Button></Space>
      </Space>
    </Card>

    <div style={styles.columns}>
      <Card title="小说列表" size="small" extra={<Select size="small" value={batch.id} style={{ width: 125 }} onChange={loadBatch} options={history.map(entry => ({ value: entry.id, label: entry.name }))} />}>
        <div style={styles.list}>{batch.items.map((item, index) => {
          const status = item.production?.projectId ? statusByProject[String(item.production.projectId)] : null;
          const [label, color] = itemStatus(item, status);
          return <div key={item.id} onClick={() => setSelectedId(item.id)} style={{ ...styles.item, ...(item.id === selected.id ? styles.selected : {}) }}>
            <Space direction="vertical" size={4} style={styles.full}><Space wrap><Typography.Text strong>{String(index + 1).padStart(2, '0')}. {item.title}</Typography.Text><Tag color={color}>{label}</Tag></Space><Space wrap>{item.bookId ? <Tag>{item.bookId}</Tag> : null}{item.platform ? <Tag color="blue">{item.platform}</Tag> : null}</Space></Space>
          </div>;
        })}</div>
      </Card>

      <Space direction="vertical" size={12} style={styles.full}>
        <Card title={`当前小说 · ${selected.title}`} size="small" extra={<Tooltip title="当前小说生产设置"><Button type="text" icon={<SettingOutlined />} onClick={() => { setBookDraft(workbench?.effectiveSettings || {}); setBookSettingsOpen(true); }} /></Tooltip>}>
          {selected.status === 'failed' ? <Alert style={{ marginBottom: 10 }} type="error" showIcon message={selected.error || '导演失败'} action={<Button size="small" onClick={() => regenerateBatchFactoryDirector(batch.id, selected.id).then(() => loadBatch(batch.id))}>重试</Button>} /> : null}
          {selected.status === 'hook_review' ? <Alert style={{ marginBottom: 10 }} type="warning" showIcon message="爆款开头待人工审核" description={<Space direction="vertical" style={styles.full}><Input.TextArea rows={5} value={hookDraft} onChange={event => setHookDraft(event.target.value)} /><Space><Button onClick={() => rewriteBatchFactoryHook(batch.id, selected.id).then(() => loadBatch(batch.id))}>重写</Button><Button type="primary" onClick={() => approveBatchFactoryHook(batch.id, selected.id, hookDraft).then(() => loadBatch(batch.id))}>确认并继续导演</Button></Space></Space>} /> : null}
          <div style={styles.currentGrid}>
            <Card hoverable style={styles.actionCard} onClick={() => setContentOpen(true)} title="小说内容"><Typography.Title level={3} style={{ marginTop: 4 }}>{workbench?.effectiveSettings?.productionLineCount === 0 ? '全部' : `前 ${workbench?.effectiveSettings?.productionLineCount ?? 10} 行`}</Typography.Title><Typography.Text type="secondary">视频制作</Typography.Text><Divider style={{ margin: '10px 0' }} /><Typography.Text>完整 TXT：{workbench?.fullTxtEffectiveLines ?? '—'} 个有效行</Typography.Text>{workbench?.productionTextCustomized ? <Tag color="orange" style={{ marginTop: 8 }}>已手动编辑制作文本</Tag> : null}</Card>
            <Card hoverable style={styles.actionCard} onClick={openAsset} title="人物 / 场景 / 道具"><Space direction="vertical"><Typography.Text>人物 {selected.directorResult?.characters?.length || 0}</Typography.Text><Typography.Text>场景 {selected.directorResult?.scenes?.length || 0}</Typography.Text><Typography.Text>道具 {selected.directorResult?.props?.length || 0}</Typography.Text><Tag>{selected.promptVersions?.assetPrompt?.name || '等待导演'}</Tag></Space></Card>
            <Card hoverable style={styles.actionCard} onClick={openStoryboard} title="分镜提示词"><Space direction="vertical"><Typography.Title level={3} style={{ margin: 0 }}>{videos.length}</Typography.Title><Typography.Text>个 VIDEO 分镜卡片</Typography.Text><Tag>{selected.promptVersions?.scriptPrompt?.name || '等待导演'}</Tag></Space></Card>
            <Card hoverable style={styles.actionCard} onClick={() => { setConstraintDraft(workbench?.effectiveSettings || {}); setConstraintOpen(true); }} title="生成约束"><Space direction="vertical"><Typography.Text>前缀 / 画质</Typography.Text><Typography.Text>人物 / 场景 / 道具一致性</Typography.Text><Typography.Text>字幕 / 限制 / 负面词</Typography.Text></Space></Card>
          </div>
          <Space wrap style={{ marginTop: 12 }}><Button onClick={() => regenerateBatchFactoryDirector(batch.id, selected.id).then(() => loadBatch(batch.id))} disabled={ACTIVE_DIRECTOR.has(selected.status)}>重新导演当前小说</Button><Button type="primary" loading={busy} disabled={!videos.length} onClick={generateCurrentBook}>生成当前小说全部待处理 VIDEO</Button></Space>
        </Card>
        {selected.staleReason ? <Alert type="warning" showIcon message={selected.staleReason} /> : null}
      </Space>

      <Space direction="vertical" size={12} style={styles.full}>
        <Card title="VIDEO" size="small" extra={<Tag>跟随当前小说</Tag>}>
          {videos.length ? <><Segmented block value={String(currentVideo?.id || '')} onChange={value => { setSelectedVideoId(String(value)); setPreviewUrl(''); }} options={videos.map((video, index) => ({ value: String(video.id), label: `VIDEO${String(index + 1).padStart(2, '0')}` }))} /><Space direction="vertical" style={{ ...styles.full, marginTop: 12 }}>
            <Space wrap><Tag>{currentVideo?.duration_sec || 0}s</Tag><Tag color={currentProduction?.stale ? 'orange' : undefined}>{currentProduction?.status || 'draft'}</Tag>{currentProduction?.stale ? <Tag color="orange">当前成品基于旧 Prompt</Tag> : null}</Space>
            <div style={styles.player}>{previewUrl ? <video controls src={previewUrl} style={{ width: '100%', maxHeight: 520 }} /> : <Button disabled={!currentProduction?.media?.id} onClick={loadPreview}>加载当前 VIDEO</Button>}</div>
            {currentProduction?.error ? <Alert type="error" message={currentProduction.error} /> : null}
            <Space wrap><Button type="primary" onClick={generateCurrentVideo}>{currentProduction?.media ? '重新生成当前 VIDEO' : '生成当前 VIDEO'}</Button><Button onClick={() => setStoryboardOpen(true)}>打开分镜卡片</Button></Space>
          </Space></> : <Empty description="当前小说还没有分镜 VIDEO" />}
        </Card>
        {selected.production?.projectId ? <Card title="合并" size="small"><MergePanel batch={batch} item={selected} status={projectStatus} refreshStatus={refreshStatus} /></Card> : null}
        <Card title="121 发布" size="small"><Button type="primary" disabled>等待真实 121 会话接入</Button><Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>发布包固定使用完整 `{selected.bookId}.txt` 与合并后的 `{selected.bookId}.mp4`；10 行/自定义制作文本不会覆盖完整 TXT。</Typography.Paragraph></Card>
      </Space>
    </div>

    <UnifiedSettings open={settingsOpen} batch={batch} onClose={() => setSettingsOpen(false)} onSaved={() => loadBatch(batch.id)} />
    <PublishSettings open={publishOpen} batch={batch} onClose={() => setPublishOpen(false)} onSaved={() => loadBatch(batch.id)} />

    <Modal title={`小说内容 · ${selected.title}`} open={contentOpen} onCancel={() => setContentOpen(false)} width="86vw" footer={<Space><Button onClick={restoreProductionText}>恢复按行数取文</Button><Button type="primary" onClick={saveProductionText}>保存制作内容</Button></Space>}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`视频制作：${workbench?.effectiveSettings?.productionLineCount === 0 ? '全部有效行' : `前 ${workbench?.effectiveSettings?.productionLineCount ?? 10} 个有效行`} · 完整 TXT：${workbench?.fullTxtEffectiveLines ?? 0} 行`} description="左侧内容用于导演和视频，可编辑；右侧完整 TXT 只读并保留用于后续 121 上传。" />
      <div style={styles.modalTwo}><div><Typography.Text strong>视频制作内容</Typography.Text><Input.TextArea rows={26} style={{ marginTop: 8 }} value={productionDraft} onChange={event => setProductionDraft(event.target.value)} /></div><div><Typography.Text strong>完整 TXT · {selected.bookId}.txt</Typography.Text><Input.TextArea rows={26} style={{ marginTop: 8 }} value={workbench?.fullTxtText || selected.txtText || ''} readOnly /></div></div>
    </Modal>

    <Modal title={`人物 / 场景 / 道具 · ${selected.title}`} open={assetOpen} onCancel={() => setAssetOpen(false)} width={900} footer={null}>
      {!selected.directorResult ? <Empty description="请先开始导演" /> : <><Tabs activeKey={assetKind} onChange={key => { setAssetKind(key); setAssetIndex(0); }} items={[['characters','人物'],['scenes','场景'],['props','道具']].map(([key,label]) => ({ key, label: `${label} ${selected.directorResult?.[key]?.length || 0}` }))} />
        {currentAsset ? <Space direction="vertical" style={styles.full}><Space wrap><Tag>{assetIndex + 1} / {currentAssets.length}</Tag><Typography.Text strong>{currentAsset.name}</Typography.Text></Space><Input.TextArea rows={16} value={assetDraft} onChange={event => setAssetDraft(event.target.value)} /><div style={styles.footerNav}><Space><Button icon={<LeftOutlined />} disabled={assetIndex <= 0} onClick={() => setAssetIndex(value => value - 1)}>上一个</Button><Button disabled={assetIndex >= currentAssets.length - 1} onClick={() => setAssetIndex(value => value + 1)}>下一个 <RightOutlined /></Button></Space><Space><Button onClick={regenerateAsset}>重生当前{assetKind === 'characters' ? '人物' : assetKind === 'scenes' ? '场景' : '道具'}</Button><Button type="primary" onClick={saveAsset}>保存</Button></Space></div></Space> : <Empty />}</>}
    </Modal>

    <Modal title={`分镜提示词 · ${selected.title}`} open={storyboardOpen} onCancel={() => setStoryboardOpen(false)} width={980} footer={null}>
      {!currentVideo ? <Empty description="请先开始导演" /> : <Space direction="vertical" style={styles.full}>
        <Space wrap><Tag>VIDEO {currentVideoIndex + 1} / {videos.length}</Tag><Tag>{currentVideo.duration_sec}s</Tag>{currentProduction?.stale ? <Tag color="orange">成品已过期</Tag> : null}<Typography.Text strong>{currentVideo.scene || '未命名场景'}</Typography.Text></Space>
        <Input.TextArea rows={18} value={storyDraft} onChange={event => setStoryDraft(event.target.value)} />
        <Space wrap><Tag>人物 {currentVideo.characters?.join('、') || '—'}</Tag><Tag>道具 {currentVideo.props?.join('、') || '—'}</Tag></Space>
        <div style={styles.footerNav}><Space><Button icon={<LeftOutlined />} disabled={currentVideoIndex <= 0} onClick={() => moveVideo(-1)}>上一个分镜</Button><Button disabled={currentVideoIndex >= videos.length - 1} onClick={() => moveVideo(1)}>下一个分镜 <RightOutlined /></Button></Space><Space><Button onClick={showCompiled}>查看最终 Prompt</Button><Button onClick={regenerateStoryboard}>重生当前分镜</Button><Button onClick={saveStoryboard}>保存</Button><Button type="primary" onClick={generateCurrentVideo}>生成视频</Button></Space></div>
      </Space>}
    </Modal>

    <Modal title={`生成约束 · ${selected.title}`} open={constraintOpen} onCancel={() => setConstraintOpen(false)} onOk={saveConstraints} okText="保存当前小说" width={760}>
      <Space direction="vertical" size={14} style={styles.full}>
        <Space wrap><Switch checked={constraintDraft.injectCharacterPrompt !== false} onChange={value => setConstraintDraft(current => ({ ...current, injectCharacterPrompt: value }))} />人物一致性 <Switch checked={constraintDraft.injectScenePrompt !== false} onChange={value => setConstraintDraft(current => ({ ...current, injectScenePrompt: value }))} />场景一致性 <Switch checked={constraintDraft.injectPropPrompt !== false} onChange={value => setConstraintDraft(current => ({ ...current, injectPropPrompt: value }))} />道具一致性</Space>
        <Input.TextArea rows={3} placeholder="画面前缀" value={constraintDraft.customPrefix || ''} onChange={event => setConstraintDraft(current => ({ ...current, customPrefix: event.target.value, prefixMode: 'manual' }))} />
        <Input.TextArea rows={3} placeholder="画质要求" value={constraintDraft.quality || ''} onChange={event => setConstraintDraft(current => ({ ...current, quality: event.target.value }))} />
        <Input.TextArea rows={3} placeholder="画面限制" value={constraintDraft.restriction || ''} onChange={event => setConstraintDraft(current => ({ ...current, restriction: event.target.value }))} />
        <Input.TextArea rows={4} placeholder="负面提示词" value={constraintDraft.negative || ''} onChange={event => setConstraintDraft(current => ({ ...current, negative: event.target.value }))} />
        <Select value={constraintDraft.subtitlePolicy || 'forbid-auto-dialogue-subtitle'} onChange={value => setConstraintDraft(current => ({ ...current, subtitlePolicy: value }))} options={[{ value: 'forbid-auto-dialogue-subtitle', label: '禁止自动对白字幕' }, { value: 'allow', label: '允许字幕' }]} />
      </Space>
    </Modal>

    <Modal title={`当前小说生产设置 · ${selected.title}`} open={bookSettingsOpen} onCancel={() => setBookSettingsOpen(false)} width={640} footer={<Space><Button onClick={resetBookSettings}>恢复统一设置</Button><Button type="primary" onClick={saveBookSettings}>保存当前小说</Button></Space>}>
      <Space direction="vertical" size={14} style={styles.full}>
        <Alert type="info" showIcon message="这里只覆盖当前小说" description="视频模型、比例、秒数、制作行数和生产方式可单独覆盖；恢复统一设置后重新继承批次。" />
        <div><Typography.Text strong>视频模型 ID</Typography.Text><InputNumber style={{ width: '100%', marginTop: 8 }} min={1} value={bookDraft.videoModelId} onChange={value => setBookDraft(current => ({ ...current, videoModelId: Number(value || 0) }))} /></div>
        <div><Typography.Text strong>画幅</Typography.Text><Segmented style={{ marginTop: 8 }} value={bookDraft.aspectRatio || '9:16'} onChange={value => setBookDraft(current => ({ ...current, aspectRatio: value }))} options={['9:16','16:9']} /></div>
        <div><Typography.Text strong>单 VIDEO 最大秒数</Typography.Text><InputNumber style={{ width: '100%', marginTop: 8 }} min={1} max={Number(bookDraft.videoModelMaxDuration || 60)} value={bookDraft.maxVideoDuration || 10} onChange={value => setBookDraft(current => ({ ...current, maxVideoDuration: Number(value || 1) }))} /></div>
        <div><Typography.Text strong>视频制作取文行数</Typography.Text><InputNumber style={{ width: '100%', marginTop: 8 }} min={0} max={500} value={bookDraft.productionLineCount ?? 10} onChange={value => setBookDraft(current => ({ ...current, productionLineCount: Number(value ?? 10) }))} /><Typography.Text type="secondary">0 = 使用全部完整 TXT 内容做视频；不影响 TXT 文件本身</Typography.Text></div>
        <div><Typography.Text strong>生产方式</Typography.Text><Segmented block style={{ marginTop: 8 }} value={bookDraft.productionMode || 'original'} onChange={value => setBookDraft(current => ({ ...current, productionMode: value }))} options={[{ value: 'original', label: '原文直转' }, { value: 'viral', label: '爆款开头' }]} /></div>
      </Space>
    </Modal>

    <Modal open={compiled.open} width={900} title="最终上传模型 Prompt" footer={<Button onClick={() => setCompiled({ open: false, loading: false, prompt: '' })}>关闭</Button>} onCancel={() => setCompiled({ open: false, loading: false, prompt: '' })}>{compiled.loading ? <Spin /> : <Input.TextArea readOnly rows={24} value={compiled.prompt} />}</Modal>
  </Space></div>;
}
