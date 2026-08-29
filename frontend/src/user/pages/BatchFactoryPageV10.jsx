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
  compileBatchFactoryVideo,
  createBatchFactoryBatch,
  generateBatchFactoryBatch,
  generateBatchFactoryVideos,
  getBatchFactoryBatch,
  getBatchFactoryIntake,
  getBatchFactoryMergeCapability,
  getBatchFactoryProductionStatus,
  listBatchFactoryBatches,
  mergeBatchFactoryVideos,
  regenerateBatchFactoryDirector,
  startBatchFactoryBatch,
  updateBatchFactoryDirectorResult,
  updateBatchFactoryItemOverrides,
  updateBatchFactoryPublishSettings,
  updateBatchFactorySettings,
  updateBatchFactorySource,
  updateBatchFactoryVideoOverrides
} from '../../shared/api/batchFactory';
import { getConfig } from '../../shared/api/config';
import { downloadMedia, listModels } from '../../shared/api/shuihuoProduction';
import { textToSpeech } from '../../shared/api/tts';
import {
  BookSettingsModal,
  UnifiedProductionSettingsModal,
  VideoSettingsOverrideModal
} from './batch-factory/BatchFactorySettingsModals';
import './batch-factory/batch-factory-settings.css';

const MERGE_SOURCE = 'batch_merge';
const ACTIVE_DIRECTOR = new Set(['queued_hook', 'hook_generating', 'queued_director', 'director_generating']);
const DEFAULT_SCRIPT = 'standard-short-drama';
const DEFAULT_ASSET = 'standard-asset-extraction';

const styles = {
  page: { width: '100%', minWidth: 0 },
  columns: { display: 'grid', gridTemplateColumns: 'minmax(230px,.72fr) minmax(430px,1.45fr) minmax(360px,1.05fr)', gap: 12, alignItems: 'start' },
  sticky: { position: 'sticky', top: 12 },
  list: { maxHeight: '72vh', overflow: 'auto' },
  item: { padding: 10, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(127,127,127,.18)', marginBottom: 8 },
  selected: { outline: '2px solid #1677ff' },
  full: { width: '100%' },
  player: { minHeight: 250, background: '#050505', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function visualPrompt(video) { return String(video?.visualPrompt || video?.visual_prompt || video?.video_desc || video?.videoDesc || '').trim(); }
function projectIds(batch) { return [...new Set((batch?.items || []).map(item => Number(item.production?.projectId)).filter(id => id > 0))]; }
function mergedMedia(status) { return [...(status?.media || [])].reverse().find(item => item.source === MERGE_SOURCE) || null; }
function hasOverrides(value) { return Boolean(value && typeof value === 'object' && Object.keys(value).length); }

function videoProduction(item, index, status) {
  if (!item?.production?.projectId) return { status: 'draft', media: null, task: null };
  const submission = (item.productionResults || []).find(result => Number(result.index) === index + 1) || item.productionResults?.[index] || null;
  const segmentId = Number(submission?.segmentId || submission?.task?.segmentId || 0);
  const taskId = Number(submission?.task?.id || 0);
  const task = [...(status?.tasks || [])].reverse().find(entry => (segmentId && Number(entry.segmentId) === segmentId) || (taskId && Number(entry.id) === taskId)) || submission?.task || null;
  const media = [...(status?.media || [])].reverse().find(entry => entry.source !== MERGE_SOURCE && ((task?.id && Number(entry.taskId) === Number(task.id)) || (segmentId && Number(entry.segmentId) === segmentId))) || null;
  return { status: media ? 'succeeded' : (task?.status || (submission ? 'queued' : 'draft')), media, task, error: task?.errorMessage || submission?.error || '' };
}

function itemStatus(item, status) {
  if (item?.status === 'failed' || item?.productionSubmissionError) return ['异常', 'red'];
  if (ACTIVE_DIRECTOR.has(item?.status)) return ['导演中', 'processing'];
  if (item?.status === 'hook_review') return ['待审核', 'gold'];
  if (!item?.directorResult?.storyboard?.length) return ['待导演', 'default'];
  if (!item?.production?.projectId) return ['待生成', 'blue'];
  const states = item.directorResult.storyboard.map((_, index) => videoProduction(item, index, status).status);
  if (states.some(state => state === 'failed' || state === 'cancelled')) return ['视频异常', 'red'];
  if (states.some(state => state === 'running')) return ['生成中', 'processing'];
  if (states.some(state => state === 'queued' || state === 'draft')) return ['排队中', 'processing'];
  if (states.length && states.every(state => state === 'succeeded')) return [mergedMedia(status) ? '已合并' : '待合并', mergedMedia(status) ? 'green' : 'cyan'];
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
        prefixEnabled: true,
        scriptPromptPresetId: DEFAULT_SCRIPT,
        assetPromptPresetId: DEFAULT_ASSET,
        injectCharacterPrompt: true,
        injectScenePrompt: true,
        injectPropPrompt: true,
        qualityEnabled: true,
        restrictionEnabled: true,
        negativeEnabled: true,
        subtitlePolicy: 'forbid-auto-dialogue-subtitle'
      };
      const result = await createBatchFactoryBatch({ mode, sourceIntakeId: intakeId, items, settings });
      const url = new URL(window.location.href);
      url.searchParams.delete('intake');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      onCreated(result.batch.id);
      message.success('小说已进入批量工厂；已冻结当前后台配置版本，请检查统一设置后开始导演');
    } catch (error) {
      message.error(error.message || '创建批次失败');
    } finally { setCreating(false); }
  }

  return <Space direction="vertical" size={14} style={styles.full}>
    <Alert showIcon type="info" message="小说获取 → 批量工厂" description="转入后先建立小说列表，不自动导演。创建批次时会冻结当前后台 Prompt 配置版本。" />
    <Card title="小说列表" extra={<Tag>{items.length} 本</Tag>}>
      {items.length ? <List dataSource={items} renderItem={item => <List.Item><List.Item.Meta title={item.title} description={<Space wrap><Tag>{item.bookId}</Tag>{item.platform ? <Tag color="blue">{item.platform}</Tag> : null}</Space>} /></List.Item>} /> : <Empty description="等待小说获取转入" />}
    </Card>
    <Card title="建立批次">
      <Space direction="vertical" style={styles.full}>
        <Segmented value={mode} onChange={setMode} options={[{ value: 'original', label: '原文直转' }, { value: 'viral', label: '爆款开头' }]} />
        <Select value={modelId} onChange={setModelId} style={styles.full} options={models.map(model => ({ value: model.id, label: `${model.name} · 最大 ${model.maxVideoDuration}s` }))} />
        <Button type="primary" loading={creating} onClick={create}>进入批量工厂</Button>
      </Space>
    </Card>
  </Space>;
}

function PublishSettings({ open, batch, onClose, onSaved }) {
  const current = batch.publishSettings || {};
  const [count, setCount] = useState(current.jieyaVideoCount ?? 4);
  const [reuse, setReuse] = useState(current.materialReuse === true);
  const [flip, setFlip] = useState(current.horizontalFlip === true);
  useEffect(() => { if (open) { setCount(current.jieyaVideoCount ?? 4); setReuse(current.materialReuse === true); setFlip(current.horizontalFlip === true); } }, [open, batch?.id]);
  async function save() {
    try {
      await updateBatchFactoryPublishSettings(batch.id, { jieyaVideoCount: count, materialReuse: reuse, horizontalFlip: flip });
      await onSaved();
      message.success('发布统一设置已保存');
      onClose();
    } catch (error) { message.error(error.message || '保存发布设置失败'); }
  }
  return <Drawer title="发布统一设置" width={460} open={open} onClose={onClose} extra={<Button type="primary" onClick={save}>保存</Button>}>
    <Space direction="vertical" size={16} style={styles.full}>
      <Space><Typography.Text>解压视频数量</Typography.Text><InputNumber min={0} max={8} value={count} onChange={value => setCount(Number(value || 0))} /></Space>
      <Space><Typography.Text>AI头部</Typography.Text><Tag color="blue">自定义AI头部</Tag></Space>
      <Space><Switch checked={reuse} onChange={setReuse} /><Typography.Text>素材复用</Typography.Text></Space>
      <Space><Switch checked={flip} onChange={setFlip} /><Typography.Text>水平翻转</Typography.Text></Space>
      <Alert showIcon type="info" message="发布元数据" description="平台、性别、风格和配置沿用小说获取已经识别并保存的数据，不在这里重新猜测。" />
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
    {strategy === 'fixed' ? <Select value={speed} onChange={setSpeed} style={{ width: 150 }} options={[1,1.1,1.2,1.3,1.5,1.7,2].map(value => ({ value, label: `${value.toFixed(1)}x` }))} /> : <Space direction="vertical"><Space wrap><Tag>测时语速 1.7</Tag><Tag>仅测时，不合入音轨</Tag><Button loading={measuring} onClick={measure}>计算音频时长</Button></Space>{measurement ? <Space wrap><Tag>目标 {measurement.target.toFixed(2)}s</Tag><Tag>VIDEO {rawDuration.toFixed(2)}s</Tag><Tag color={measurement.valid ? 'blue' : 'red'}>{measurement.ratio.toFixed(3)}x</Tag></Space> : null}</Space>}
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
  const [videoSettingsOpen, setVideoSettingsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sourceDraft, setSourceDraft] = useState('');
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
  const currentVideoOverride = currentVideo ? selected?.videoSettingsOverrides?.[String(currentVideo.id)] : null;

  async function refreshHistory() { try { setHistory((await listBatchFactoryBatches()).batches || []); } catch (_) {} }
  async function loadBatch(id) {
    const result = await getBatchFactoryBatch(id);
    setBatch(result.batch);
    setSelectedId(current => result.batch.items?.some(item => item.id === current) ? current : (result.batch.items?.[0]?.id || ''));
  }
  async function refreshStatus() {
    const ids = projectIds(batch);
    if (!ids.length) return setStatusByProject({});
    try { setStatusByProject((await getBatchFactoryProductionStatus(ids)).projects || {}); } catch (_) {}
  }

  useEffect(() => { refreshHistory(); const intake = new URLSearchParams(window.location.search).get('intake'); if (!intake) listBatchFactoryBatches().then(result => { if (result.batches?.[0]) loadBatch(result.batches[0].id); }).catch(() => {}); }, []);
  useEffect(() => { if (!batch) return; const timer = window.setInterval(() => { loadBatch(batch.id).catch(() => {}); refreshStatus(); }, 2500); return () => clearInterval(timer); }, [batch?.id, projectIds(batch).join(',')]);
  useEffect(() => { if (!selected) return; setSourceDraft(selected.sourceText || ''); setSelectedVideo(String(selected.directorResult?.storyboard?.[0]?.id || '')); setAssetDrafts({}); setVideoDrafts({}); setPreviewUrl(''); setBookSettingsOpen(false); setVideoSettingsOpen(false); if (previewRef.current) { URL.revokeObjectURL(previewRef.current); previewRef.current = ''; } }, [selected?.id]);
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
        message.success(`已按小说列表顺序提交 ${result.succeededItems || 0} 本 / ${result.queuedVideos || 0} 个 VIDEO`);
      } else {
        await startBatchFactoryBatch(batch.id);
        message.success('已按小说列表从上到下开始导演');
      }
      await loadBatch(batch.id);
      await refreshStatus();
    } catch (error) { message.error(error.message || '操作失败'); }
    finally { setBusy(false); }
  }

  async function saveUnifiedSettings(settings) {
    setSavingSettings(true);
    try {
      await updateBatchFactorySettings(batch.id, settings);
      await loadBatch(batch.id);
      setSettingsOpen(false);
      message.success('生产统一设置已保存；当前小说和单 VIDEO 覆盖保持不变');
    } catch (error) { message.error(error.message || '保存生产统一设置失败'); }
    finally { setSavingSettings(false); }
  }

  async function saveBookSettings(settings, inheritKeys) {
    if (!selected) return;
    setSavingSettings(true);
    try {
      await updateBatchFactoryItemOverrides(batch.id, selected.id, settings, inheritKeys);
      await loadBatch(batch.id);
      setBookSettingsOpen(false);
      message.success('当前小说设置已保存');
    } catch (error) { message.error(error.message || '保存当前小说设置失败'); }
    finally { setSavingSettings(false); }
  }

  async function saveVideoSettings(settings, inheritKeys) {
    if (!selected || !currentVideo) return;
    setSavingSettings(true);
    try {
      await updateBatchFactoryVideoOverrides(batch.id, selected.id, currentVideo.id, settings, inheritKeys);
      await loadBatch(batch.id);
      setVideoSettingsOpen(false);
      message.success(`VIDEO ${currentVideo.id} 设置覆盖已保存`);
    } catch (error) { message.error(error.message || '保存 VIDEO 设置失败'); }
    finally { setSavingSettings(false); }
  }

  async function saveSource() {
    try { await updateBatchFactorySource(batch.id, selected.id, sourceDraft, sourceDraft); await loadBatch(batch.id); message.success('正文已保存，旧导演结果已失效'); }
    catch (error) { message.error(error.message || '保存正文失败'); }
  }

  async function saveDirector(next, text) {
    try { await updateBatchFactoryDirectorResult(batch.id, selected.id, next); await loadBatch(batch.id); message.success(text || '已保存'); }
    catch (error) { message.error(error.message || '保存失败'); }
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
    saveDirector(next, `VIDEO ${video.id} 剧情/画面描述已保存`);
  }
  async function showCompiled(video) {
    setCompiled({ open: true, loading: true, prompt: '' });
    try { const result = await compileBatchFactoryVideo(batch.id, selected.id, video.id); setCompiled({ open: true, loading: false, prompt: result.payload?.prompt || '' }); }
    catch (error) { setCompiled({ open: true, loading: false, prompt: error.message || '编译失败' }); }
  }
  async function generateCurrentBook() {
    setBusy(true);
    try { await generateBatchFactoryVideos(batch.id, selected.id, Number(batch.settings.videoModelId)); await loadBatch(batch.id); message.success('当前小说全部 VIDEO 已提交'); }
    catch (error) { message.error(error.message || '提交失败'); }
    finally { setBusy(false); }
  }
  async function loadPreview() {
    const id = Number(currentProduction?.media?.id || 0);
    if (!id) return message.warning('当前 VIDEO 尚无成品');
    try {
      const blob = await downloadMedia(id); const url = URL.createObjectURL(blob);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current); previewRef.current = url; setPreviewUrl(url);
    } catch (error) { message.error(error.message || '加载视频失败'); }
  }

  return <div style={styles.page}><Space direction="vertical" size={12} style={styles.full}>
    <Card size="small">
      <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
        <Space wrap>
          <Typography.Title level={4} style={{ margin: 0 }}>批量工厂</Typography.Title>
          <Tag>{batch.items.length} 本</Tag>
          <Tag>{batch.settings?.videoModelName}</Tag>
          {batch.settings?.systemConfigLabel ? <Tag color="geekblue">{batch.settings.systemConfigLabel}</Tag> : <Tag color="gold">未冻结版本</Tag>}
        </Space>
        <Space wrap><Button onClick={() => setSettingsOpen(true)}>生产统一设置</Button><Button onClick={() => setPublishOpen(true)}>发布统一设置</Button><Button type="primary" loading={busy} disabled={directorActive || hasReview} onClick={primaryAction}>{primaryLabel}</Button></Space>
      </Space>
    </Card>

    <div style={styles.columns}>
      <Card title="小说列表" size="small" style={styles.sticky} extra={<Select size="small" value={batch.id} style={{ width: 130 }} onChange={loadBatch} options={history.map(entry => ({ value: entry.id, label: entry.name }))} />}>
        <div style={styles.list}>{batch.items.map((item, index) => {
          const status = item.production?.projectId ? statusByProject[String(item.production.projectId)] : null;
          const [label, color] = itemStatus(item, status);
          return <div key={item.id} onClick={() => setSelectedId(item.id)} style={{ ...styles.item, ...(item.id === selected.id ? styles.selected : {}) }}>
            <Space direction="vertical" size={4} style={styles.full}>
              <Space wrap><Typography.Text strong>{String(index + 1).padStart(2, '0')}. {item.title}</Typography.Text><Tag color={color}>{label}</Tag>{hasOverrides(item.settingsOverride) ? <Tag color="purple">单书覆盖</Tag> : null}</Space>
              <Space wrap>{item.bookId ? <Tag>{item.bookId}</Tag> : null}{item.platform ? <Tag color="blue">{item.platform}</Tag> : null}</Space>
            </Space>
          </div>;
        })}</div>
      </Card>

      <Space direction="vertical" size={12} style={styles.full}>
        <Card
          title="2. 当前小说 / 导演 Prompt"
          size="small"
          extra={<Space>{selected.sourceTaskId ? <Tag>来源 #{selected.sourceTaskId}</Tag> : null}{hasOverrides(selected.settingsOverride) ? <Tag color="purple">当前小说已覆盖</Tag> : <Tag>继承统一设置</Tag>}<Button size="small" onClick={() => setBookSettingsOpen(true)}>约束设置</Button><Button size="small" onClick={saveSource}>保存正文</Button></Space>}
        >
          <Input.TextArea rows={8} value={sourceDraft} onChange={event => setSourceDraft(event.target.value)} />
          {selected.status === 'failed' ? <Alert style={{ marginTop: 10 }} type="error" showIcon message={selected.error || '导演失败'} /> : null}
          {selected.directorResult ? <Space direction="vertical" size={10} style={{ ...styles.full, marginTop: 12 }}>
            <Space wrap><Tag>剧本：{selected.promptVersions?.scriptPrompt?.name || '标准短剧分镜'}</Tag><Tag>资产：{selected.promptVersions?.assetPrompt?.name || '标准资产提取'}</Tag><Button size="small" onClick={async () => { await regenerateBatchFactoryDirector(batch.id, selected.id); await loadBatch(batch.id); }}>重新导演当前小说</Button><Button type="primary" size="small" loading={busy} disabled={Boolean(selected.production?.projectId)} onClick={generateCurrentBook}>生成当前小说全部 VIDEO</Button></Space>
            <Collapse items={[
              { key: 'characters', label: `人物 ${selected.directorResult.characters?.length || 0}`, children: <Space direction="vertical" style={styles.full}>{(selected.directorResult.characters || []).map((asset, index) => <Card size="small" key={`${asset.name}-${index}`} title={asset.name}><Input.TextArea rows={4} value={assetDrafts[`characters-${index}`] ?? asset.prompt} onChange={event => setAssetDrafts(current => ({ ...current, [`characters-${index}`]: event.target.value }))} /><Button size="small" style={{ marginTop: 8 }} onClick={() => editAsset('characters', index, assetDrafts[`characters-${index}`] ?? asset.prompt)}>保存</Button></Card>)}</Space> },
              { key: 'scenes', label: `场景 ${selected.directorResult.scenes?.length || 0}`, children: <Space direction="vertical" style={styles.full}>{(selected.directorResult.scenes || []).map((asset, index) => <Card size="small" key={`${asset.name}-${index}`} title={asset.name}><Input.TextArea rows={4} value={assetDrafts[`scenes-${index}`] ?? asset.prompt} onChange={event => setAssetDrafts(current => ({ ...current, [`scenes-${index}`]: event.target.value }))} /><Button size="small" style={{ marginTop: 8 }} onClick={() => editAsset('scenes', index, assetDrafts[`scenes-${index}`] ?? asset.prompt)}>保存</Button></Card>)}</Space> },
              { key: 'props', label: `道具 ${selected.directorResult.props?.length || 0}`, children: <Space direction="vertical" style={styles.full}>{(selected.directorResult.props || []).map((asset, index) => <Card size="small" key={`${asset.name}-${index}`} title={asset.name}><Input.TextArea rows={4} value={assetDrafts[`props-${index}`] ?? asset.prompt} onChange={event => setAssetDrafts(current => ({ ...current, [`props-${index}`]: event.target.value }))} /><Button size="small" style={{ marginTop: 8 }} onClick={() => editAsset('props', index, assetDrafts[`props-${index}`] ?? asset.prompt)}>保存</Button></Card>)}</Space> }
            ]} />
            {videos.length ? <Card size="small" title="VIDEO 剧情 / 画面描述"><Tabs items={videos.map(video => ({ key: String(video.id), label: `VIDEO${String(video.id).padStart(2, '0')}`, children: <Space direction="vertical" style={styles.full}><Input.TextArea rows={7} value={videoDrafts[String(video.id)] ?? visualPrompt(video)} onChange={event => setVideoDrafts(current => ({ ...current, [String(video.id)]: event.target.value }))} /><Space><Button onClick={() => editVideo(video, videoDrafts[String(video.id)] ?? visualPrompt(video))}>保存剧情描述</Button><Button onClick={() => showCompiled(video)}>查看最终上传 Prompt</Button></Space></Space> }))} /></Card> : null}
          </Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击顶部【开始导演】后，这里生成当前小说的人物、场景、道具与 VIDEO Prompt" />}
        </Card>
      </Space>

      <Space direction="vertical" size={12} style={styles.full}>
        <Card title="3. VIDEO" size="small" extra={<Space><Tag>跟随当前小说</Tag>{hasOverrides(currentVideoOverride) ? <Tag color="magenta">VIDEO 已覆盖</Tag> : null}<Button size="small" disabled={!currentVideo} onClick={() => setVideoSettingsOpen(true)}>约束设置</Button></Space>}>
          {videos.length ? <><Segmented block value={String(currentVideo?.id || '')} onChange={value => { setSelectedVideo(String(value)); setPreviewUrl(''); setVideoSettingsOpen(false); }} options={videos.map(video => ({ value: String(video.id), label: `VIDEO${String(video.id).padStart(2, '0')}` }))} /><Space direction="vertical" style={{ ...styles.full, marginTop: 12 }}>
            <Space wrap><Tag>{currentVideo?.duration_sec || 0}s</Tag><Tag>{currentProduction?.status || 'draft'}</Tag><Tag>人物 {currentVideo?.characters?.length || 0}</Tag><Tag>场景 {currentVideo?.scene ? 1 : 0}</Tag><Tag>道具 {currentVideo?.props?.length || 0}</Tag></Space>
            <div style={styles.player}>{previewUrl ? <video controls src={previewUrl} style={{ width: '100%', maxHeight: 520 }} /> : <Button disabled={!currentProduction?.media?.id} onClick={loadPreview}>加载当前 VIDEO</Button>}</div>
            {currentProduction?.error ? <Alert type="error" message={currentProduction.error} /> : null}
          </Space></> : <Empty description="当前小说还没有 VIDEO" />}
        </Card>
        {selected.production?.projectId ? <Card title="合并 / 发布" size="small"><MergePanel batch={batch} item={selected} status={projectStatus} refreshStatus={refreshStatus} /><Divider /><Space direction="vertical" style={styles.full}><Button type="primary" disabled>发布到 121</Button><Typography.Text type="secondary">121 真发布接口正在接入；在真实会话、组织归属和配置档字段接通前不做假上传。最终发布将携带 {selected.bookId}.mp4 + {selected.bookId}.txt。</Typography.Text></Space></Card> : null}
      </Space>
    </div>
  </Space>

  <UnifiedProductionSettingsModal open={settingsOpen} settings={batch.settings || {}} onClose={() => setSettingsOpen(false)} onSave={saveUnifiedSettings} saving={savingSettings} />
  <BookSettingsModal open={bookSettingsOpen} item={selected} batchSettings={batch.settings || {}} onClose={() => setBookSettingsOpen(false)} onSave={saveBookSettings} saving={savingSettings} />
  <VideoSettingsOverrideModal open={videoSettingsOpen} video={currentVideo} item={selected} batchSettings={batch.settings || {}} onClose={() => setVideoSettingsOpen(false)} onSave={saveVideoSettings} saving={savingSettings} />
  <PublishSettings open={publishOpen} batch={batch} onClose={() => setPublishOpen(false)} onSaved={() => loadBatch(batch.id)} />
  <Modal open={compiled.open} width={900} title="最终上传模型 Prompt" footer={<Button onClick={() => setCompiled({ open: false, loading: false, prompt: '' })}>关闭</Button>} onCancel={() => setCompiled({ open: false, loading: false, prompt: '' })}>{compiled.loading ? <Spin /> : <Input.TextArea readOnly rows={24} value={compiled.prompt} />}</Modal>
  </div>;
}
