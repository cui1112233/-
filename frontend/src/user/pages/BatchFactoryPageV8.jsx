import {
  Alert,
  Button,
  Card,
  Collapse,
  Divider,
  Empty,
  Input,
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
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  approveBatchFactoryHook,
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
  rewriteBatchFactoryHook,
  startBatchFactoryBatch,
  updateBatchFactoryDirectorResult
} from '../../shared/api/batchFactory';
import { getConfig } from '../../shared/api/config';
import { downloadMedia, listModels } from '../../shared/api/shuihuoProduction';
import { textToSpeech } from '../../shared/api/tts';

const ACTIVE_AI_STATUSES = new Set(['queued_hook', 'hook_generating', 'queued_director', 'director_generating']);
const MERGE_SOURCE = 'batch_merge';
const DEFAULT_STYLE = '高质量动漫短视频';

const BOOK_STATUS_META = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待开始' },
  { key: 'review', label: '待审核', color: 'gold' },
  { key: 'ai_processing', label: 'AI处理中', color: 'processing' },
  { key: 'ready_generate', label: '待生成', color: 'blue' },
  { key: 'queued', label: '排队中', color: 'processing' },
  { key: 'generating', label: '视频生成中', color: 'processing' },
  { key: 'failed', label: '异常', color: 'red' },
  { key: 'ready_merge', label: '待合并', color: 'cyan' },
  { key: 'merged', label: '已合并', color: 'green' }
];

const VIDEO_STATUS_META = {
  draft: ['待生成', 'default'],
  queued: ['排队中', 'processing'],
  running: ['生成中', 'processing'],
  succeeded: ['已完成', 'green'],
  failed: ['失败', 'red'],
  cancelled: ['失败', 'red']
};

const styles = {
  page: { width: '100%', minWidth: 0 },
  full: { width: '100%' },
  statusGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.45fr) minmax(320px, .75fr)',
    gap: 12,
    alignItems: 'stretch'
  },
  filterList: {
    maxHeight: 220,
    overflow: 'auto',
    border: '1px solid rgba(127,127,127,.18)',
    borderRadius: 8
  },
  filterRow: {
    padding: '9px 12px',
    borderBottom: '1px solid rgba(127,127,127,.12)',
    cursor: 'pointer'
  },
  blocks: { display: 'grid', gap: 14, width: '100%' },
  assetGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 10 },
  mediaStage: {
    minHeight: 280,
    borderRadius: 10,
    border: '1px solid rgba(127,127,127,.2)',
    background: '#050505',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  }
};

function inferTitle(text, index) {
  const first = String(text || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
  return first.replace(/^[#《【\s]+|[》】#\s]+$/g, '').slice(0, 36) || `开篇 ${index + 1}`;
}

function splitPastedText(value) {
  return String(value || '').split(/\n\s*(?:---+|===+)\s*\n/g)
    .map(text => text.trim())
    .filter(Boolean)
    .map((sourceText, index) => ({ title: inferTitle(sourceText, index), sourceText }));
}

function visualPromptOf(video) {
  return String(video?.visualPrompt || video?.visual_prompt || video?.video_desc || video?.videoDesc || '').trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function replaceVideoPrompt(directorResult, videoId, value) {
  const next = clone(directorResult);
  const video = (next.storyboard || []).find(entry => String(entry.id) === String(videoId));
  if (!video) throw new Error('VIDEO 不存在');
  video.visualPrompt = String(value || '').trim();
  // Legacy compiler compatibility. New UI treats visualPrompt as the canonical field.
  video.video_desc = video.visualPrompt;
  return next;
}

function replaceAssetPrompt(directorResult, kind, index, value) {
  const next = clone(directorResult);
  if (!Array.isArray(next[kind]) || !next[kind][index]) throw new Error('资产不存在');
  next[kind][index].prompt = String(value || '').trim();
  return next;
}

function productionProjectIds(batch) {
  return [...new Set((batch?.items || [])
    .map(item => Number(item.production?.projectId))
    .filter(id => Number.isInteger(id) && id > 0))];
}

function resolveVideoProduction(item, index, projectStatus) {
  if (!item?.production?.projectId) return null;
  const results = Array.isArray(item.productionResults) ? item.productionResults : [];
  const submission = results.find(result => Number(result.index) === index + 1) || results[index] || null;
  if (submission?.error && !submission?.task) return { status: 'failed', error: submission.error, media: null, task: null };

  const segmentId = Number(submission?.segmentId || submission?.task?.segmentId || 0);
  const submittedTaskId = Number(submission?.task?.id || 0);
  const tasks = Array.isArray(projectStatus?.tasks) ? projectStatus.tasks : [];
  const task = [...tasks].reverse().find(entry => (
    (segmentId > 0 && Number(entry.segmentId) === segmentId)
    || (submittedTaskId > 0 && Number(entry.id) === submittedTaskId)
  )) || submission?.task || null;
  const media = [...(projectStatus?.media || [])].reverse().find(entry => (
    entry.source !== MERGE_SOURCE
    && ((task?.id && Number(entry.taskId) === Number(task.id))
      || (segmentId > 0 && Number(entry.segmentId) === segmentId))
  )) || null;

  return {
    status: media ? 'succeeded' : (task?.status || (submission ? 'queued' : 'draft')),
    error: task?.errorMessage || submission?.error || '',
    media,
    task
  };
}

function mergedMediaOf(projectStatus) {
  return [...(projectStatus?.media || [])].reverse().find(media => media.source === MERGE_SOURCE) || null;
}

function resolveBookStatus(item, projectStatus) {
  if (item?.status === 'failed' || Number(item?.production?.failed || 0) > 0) return 'failed';
  if (item?.status === 'hook_review') return 'review';
  if (ACTIVE_AI_STATUSES.has(item?.status)) return 'ai_processing';
  if (!item?.production?.projectId) {
    if (item?.status === 'complete' && item?.directorResult?.storyboard?.length) return 'ready_generate';
    return 'pending';
  }
  const states = (item.directorResult?.storyboard || []).map((_, index) => resolveVideoProduction(item, index, projectStatus)?.status || 'draft');
  if (states.some(status => status === 'failed' || status === 'cancelled')) return 'failed';
  if (states.some(status => status === 'running')) return 'generating';
  if (states.some(status => status === 'queued' || status === 'draft')) return 'queued';
  if (states.length && states.every(status => status === 'succeeded')) return mergedMediaOf(projectStatus) ? 'merged' : 'ready_merge';
  return 'queued';
}

function bookStatusTag(status) {
  const meta = BOOK_STATUS_META.find(entry => entry.key === status) || { label: status || '未知' };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function audioDuration(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = Number(audio.duration);
      URL.revokeObjectURL(url);
      if (Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(new Error('无法读取 TTS 音频时长'));
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取 TTS 音频元数据'));
    };
    audio.src = url;
  });
}

function SetupView({ onOpened }) {
  const [draftItems, setDraftItems] = useState([]);
  const [sourceIntakeId, setSourceIntakeId] = useState('');
  const [pasted, setPasted] = useState('');
  const [mode, setMode] = useState('original');
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [fixedSingleVideo, setFixedSingleVideo] = useState(false);
  const [prefixMode, setPrefixMode] = useState('auto');
  const [customPrefix, setCustomPrefix] = useState('');
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [quality, setQuality] = useState('');
  const [restriction, setRestriction] = useState('');
  const [negative, setNegative] = useState('');
  const [creating, setCreating] = useState(false);
  const intakeLoaded = useRef('');

  const compatibleModels = useMemo(() => models.filter(model => (
    model.kind === 'video'
    && model.requiresImageInput !== true
    && Number.isInteger(Number(model.maxVideoDuration))
    && Number(model.maxVideoDuration) >= 1
  )), [models]);
  const selectedModel = compatibleModels.find(model => Number(model.id) === Number(modelId)) || null;

  useEffect(() => {
    let active = true;
    setLoadingModels(true);
    listModels()
      .then(result => {
        if (!active) return;
        const next = result.models || [];
        setModels(next);
        const first = next.find(model => model.kind === 'video' && model.requiresImageInput !== true && Number(model.maxVideoDuration) >= 1);
        if (first) setModelId(first.id);
      })
      .catch(error => message.error(error.message || '读取视频模型失败'))
      .finally(() => { if (active) setLoadingModels(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const intakeId = new URLSearchParams(window.location.search).get('intake') || '';
    if (!intakeId || intakeLoaded.current === intakeId) return;
    intakeLoaded.current = intakeId;
    getBatchFactoryIntake(intakeId)
      .then(result => {
        const intake = result.intake;
        if (intake?.batchId) return onOpened(intake.batchId);
        setSourceIntakeId(intakeId);
        setDraftItems(Array.isArray(intake?.items) ? intake.items : []);
      })
      .catch(error => message.error(error.message || '读取小说获取任务失败'));
  }, [onOpened]);

  function addPasted() {
    const next = splitPastedText(pasted);
    if (!next.length) return message.warning('请先粘贴小说内容');
    setDraftItems(current => [...current, ...next].slice(0, 200));
    setPasted('');
  }

  async function createAndStart() {
    if (!draftItems.length) return message.warning('至少需要一本小说');
    if (!selectedModel) return message.warning('请选择可用的文生视频模型');
    setCreating(true);
    try {
      const created = await createBatchFactoryBatch({
        mode,
        sourceIntakeId,
        items: draftItems,
        settings: {
          videoModelId: selectedModel.id,
          videoModelVersionId: selectedModel.versionId,
          videoModelName: selectedModel.name,
          maxVideoDuration: Number(selectedModel.maxVideoDuration),
          fixedSingleVideo,
          aspectRatio,
          prefixMode,
          customPrefix,
          style,
          quality,
          restriction,
          negative
        }
      });
      const started = await startBatchFactoryBatch(created.batch.id);
      const url = new URL(window.location.href);
      url.searchParams.delete('intake');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      onOpened(started.batch.id);
      message.success('批次已开始制作');
    } catch (error) {
      message.error(error.message || '创建批次失败');
    } finally {
      setCreating(false);
    }
  }

  return <Space direction="vertical" size={14} style={styles.full}>
    <Alert type="info" showIcon message="小说获取是正常入口" description="从小说获取转入会继承 sourceTaskId、bookId、平台、TXT 和来源元数据；手动粘贴仅作为备用。" />
    <Card title="待生产小说" extra={<Tag>{draftItems.length} / 200 本</Tag>}>
      {draftItems.length ? <List
        size="small"
        dataSource={draftItems}
        renderItem={item => <List.Item>
          <List.Item.Meta title={item.title} description={<Space wrap>{item.bookId ? <Tag>书ID {item.bookId}</Tag> : null}{item.platform ? <Tag color="blue">{item.platform}</Tag> : null}</Space>} />
        </List.Item>}
      /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="等待小说获取转入" />}
      <Collapse style={{ marginTop: 12 }} items={[{
        key: 'manual',
        label: '其他导入方式（备用）',
        children: <Space direction="vertical" style={styles.full}>
          <Input.TextArea rows={6} value={pasted} onChange={event => setPasted(event.target.value)} placeholder="多篇之间用 --- 分隔" />
          <Button onClick={addPasted}>加入待生产列表</Button>
        </Space>
      }]} />
    </Card>

    <Card title="生产统一设置">
      <Space direction="vertical" size={14} style={styles.full}>
        <div><Typography.Text strong>生产方式</Typography.Text><div style={{ marginTop: 8 }}><Segmented value={mode} onChange={setMode} options={[{ value: 'original', label: '原文直转' }, { value: 'viral', label: '爆款开头' }]} /></div></div>
        <div><Typography.Text strong>视频模型</Typography.Text><Select loading={loadingModels} value={modelId} onChange={setModelId} style={{ width: '100%', marginTop: 8 }} options={compatibleModels.map(model => ({ value: model.id, label: `${model.name} · 单次最大 ${model.maxVideoDuration}s` }))} /></div>
        <div><Typography.Text strong>视频画幅</Typography.Text><div style={{ marginTop: 8 }}><Segmented value={aspectRatio} onChange={setAspectRatio} options={['9:16', '16:9']} /></div></div>
        <Space align="center"><Switch checked={fixedSingleVideo} onChange={setFixedSingleVideo} /><Typography.Text>固定单 VIDEO</Typography.Text><Typography.Text type="secondary">关闭时 AI 在模型最大时长内自然拆分。</Typography.Text></Space>
        <Collapse items={[{
          key: 'constraints',
          label: '提示词与生成约束',
          children: <Space direction="vertical" size={10} style={styles.full}>
            <div><Typography.Text strong>画面前缀</Typography.Text><div style={{ marginTop: 8 }}><Segmented value={prefixMode} onChange={setPrefixMode} options={[{ value: 'auto', label: 'AI自动' }, { value: 'manual', label: '统一手动' }]} /></div><Input.TextArea rows={3} value={customPrefix} onChange={event => setCustomPrefix(event.target.value)} style={{ marginTop: 8 }} /></div>
            <div><Typography.Text strong>项目风格</Typography.Text><Input value={style} onChange={event => setStyle(event.target.value)} style={{ marginTop: 8 }} /></div>
            <div><Typography.Text strong>画质要求</Typography.Text><Input.TextArea rows={3} value={quality} onChange={event => setQuality(event.target.value)} style={{ marginTop: 8 }} /></div>
            <div><Typography.Text strong>画面限制</Typography.Text><Input.TextArea rows={3} value={restriction} onChange={event => setRestriction(event.target.value)} style={{ marginTop: 8 }} /></div>
            <div><Typography.Text strong>负面提示词</Typography.Text><Input.TextArea rows={3} value={negative} onChange={event => setNegative(event.target.value)} style={{ marginTop: 8 }} /></div>
            <Typography.Text type="secondary">人物 / 场景 / 道具 Prompt 与画面提示词分离，点击生成时才编译完整提交内容。</Typography.Text>
          </Space>
        }]} />
        <Button type="primary" size="large" loading={creating} onClick={createAndStart}>应用统一设置并开始制作 {draftItems.length} 本</Button>
      </Space>
    </Card>
  </Space>;
}

function AssetSection({ item, onSave }) {
  const [drafts, setDrafts] = useState({});
  const director = item.directorResult;
  useEffect(() => { setDrafts({}); }, [item.id, director]);
  if (!director) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="等待导演生成资产" />;

  function renderKind(kind, label) {
    const data = Array.isArray(director[kind]) ? director[kind] : [];
    return <div style={styles.assetGrid}>{data.map((entry, index) => {
      const key = `${kind}:${index}`;
      const value = drafts[key] ?? entry.prompt ?? '';
      return <Card key={key} size="small" title={entry.name || `${label}${index + 1}`}>
        <Input.TextArea rows={6} value={value} onChange={event => setDrafts(current => ({ ...current, [key]: event.target.value }))} />
        <Space wrap style={{ marginTop: 8 }}>
          <Button onClick={() => onSave(replaceAssetPrompt(director, kind, index, value), `${entry.name || label} Prompt 已保存`)}>保存修改</Button>
          <Button onClick={() => setDrafts(current => ({ ...current, [key]: entry.prompt || '' }))}>恢复 AI 版本</Button>
        </Space>
      </Card>;
    })}</div>;
  }

  return <Tabs items={[
    { key: 'characters', label: `人物 ${director.characters?.length || 0}`, children: renderKind('characters', '人物') },
    { key: 'scenes', label: `场景 ${director.scenes?.length || 0}`, children: renderKind('scenes', '场景') },
    { key: 'props', label: `道具 ${director.props?.length || 0}`, children: renderKind('props', '道具') }
  ]} />;
}

function VideoSection({ batch, item, projectStatus, onSaveDirector, onRefresh, onBulkGenerate, bulkSubmitting }) {
  const [drafts, setDrafts] = useState({});
  const [compiled, setCompiled] = useState({ open: false, loading: false, title: '', prompt: '', error: '' });
  const [submitting, setSubmitting] = useState(false);
  const videos = item.directorResult?.storyboard || [];
  useEffect(() => { setDrafts({}); }, [item.id, item.directorResult]);

  async function previewCompiled(video) {
    setCompiled({ open: true, loading: true, title: `VIDEO ${String(video.id).padStart(2, '0')} · 本次提交预览`, prompt: '', error: '' });
    try {
      const result = await compileBatchFactoryVideo(batch.id, item.id, video.id);
      setCompiled(current => ({ ...current, loading: false, prompt: result.prompt || result.payload?.prompt || '', error: '' }));
    } catch (error) {
      setCompiled(current => ({ ...current, loading: false, error: error.message || '编译失败' }));
    }
  }

  async function generateBook() {
    if (!batch.settings?.videoModelId) return message.warning('当前批次没有绑定视频模型');
    setSubmitting(true);
    try {
      await generateBatchFactoryVideos(batch.id, item.id, Number(batch.settings.videoModelId));
      message.success('当前小说全部 VIDEO 已提交');
      await onRefresh();
    } catch (error) {
      message.error(error.message || '提交视频生产失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (!videos.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="等待 VIDEO 导演结果" />;

  return <>
    <Space direction="vertical" size={10} style={styles.full}>
      <Space wrap>
        <Tag color="blue">{batch.settings?.videoModelName || '未记录模型'}</Tag>
        <Tag>最大 {batch.settings?.maxVideoDuration || '—'}s</Tag>
        <Tag>{batch.settings?.aspectRatio || '9:16'}</Tag>
        <Button type="primary" loading={submitting} disabled={Boolean(item.production?.projectId) || item.status !== 'complete'} onClick={generateBook}>生成当前小说全部 VIDEO</Button>
        <Button loading={bulkSubmitting} onClick={onBulkGenerate}>生成全部待生产小说</Button>
      </Space>
      <Collapse items={videos.map((video, index) => {
        const key = String(video.id);
        const value = drafts[key] ?? visualPromptOf(video);
        const production = resolveVideoProduction(item, index, projectStatus);
        const [label, color] = VIDEO_STATUS_META[production?.status || 'draft'] || ['待生成', 'default'];
        return {
          key,
          label: <Space wrap><Typography.Text strong>VIDEO {String(video.id).padStart(2, '0')} · {video.duration_sec}s</Typography.Text><Tag color={color}>{label}</Tag><Tag>人物 {video.characters?.length || 0}</Tag><Tag>场景 {video.scene ? 1 : 0}</Tag><Tag>道具 {video.props?.length || 0}</Tag></Space>,
          children: <Space direction="vertical" size={10} style={styles.full}>
            {production?.error ? <Alert type="error" showIcon message="当前 VIDEO 失败" description={production.error} /> : null}
            <Typography.Text type="secondary">画面提示词只描述本 VIDEO 要拍什么。前缀、人物、场景、道具、画质、限制、字幕、负面词在生成时按开启项附加。</Typography.Text>
            <div><Typography.Text strong>画面提示词</Typography.Text><Input.TextArea rows={8} value={value} onChange={event => setDrafts(current => ({ ...current, [key]: event.target.value }))} style={{ marginTop: 8 }} /></div>
            <Space wrap>
              <Tag>前缀 ✓</Tag><Tag>人物 ✓</Tag><Tag>场景 ✓</Tag><Tag>道具 ✓</Tag><Tag>画质 {batch.settings?.quality ? '✓' : '—'}</Tag><Tag>限制 {batch.settings?.restriction ? '✓' : '—'}</Tag><Tag>禁止自动对白字幕 ✓</Tag><Tag>负面 {batch.settings?.negative ? '✓' : '—'}</Tag>
            </Space>
            <Space wrap>
              <Button onClick={() => onSaveDirector(replaceVideoPrompt(item.directorResult, video.id, value), `VIDEO ${video.id} 画面提示词已保存`)}>保存修改</Button>
              <Button onClick={() => setDrafts(current => ({ ...current, [key]: visualPromptOf(video) }))}>恢复 AI 版本</Button>
              <Button onClick={() => previewCompiled(video)}>本次提交预览</Button>
            </Space>
          </Space>
        };
      })} />
    </Space>
    <Modal open={compiled.open} title={compiled.title} width={860} onCancel={() => setCompiled({ open: false, loading: false, title: '', prompt: '', error: '' })} footer={<Button onClick={() => setCompiled({ open: false, loading: false, title: '', prompt: '', error: '' })}>关闭</Button>}>
      {compiled.loading ? <Spin /> : compiled.error ? <Alert type="error" showIcon message="编译失败" description={compiled.error} /> : <>
        <Alert type="info" showIcon message="这是本次真正提交的视频 compiledPrompt" description="它由 visualPrompt 和当前开启的注入项临时编译，不会覆盖画面提示词。" />
        <Input.TextArea readOnly value={compiled.prompt} style={{ width: '100%', minHeight: 420, marginTop: 12 }} />
      </>}
    </Modal>
  </>;
}

function MediaMergeSection({ batch, item, projectStatus, onRefreshProduction }) {
  const [mediaKey, setMediaKey] = useState('merged');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [mergeCapability, setMergeCapability] = useState(null);
  const [timingStrategy, setTimingStrategy] = useState('fixed');
  const [fixedSpeed, setFixedSpeed] = useState(1.5);
  const [ttsMeasurement, setTtsMeasurement] = useState(null);
  const [measuring, setMeasuring] = useState(false);
  const [merging, setMerging] = useState(false);
  const previewRef = useRef('');

  const videos = item.directorResult?.storyboard || [];
  const videoStates = videos.map((video, index) => ({ video, production: resolveVideoProduction(item, index, projectStatus) }));
  const merged = mergedMediaOf(projectStatus);
  const mediaIds = videoStates.map(entry => Number(entry.production?.media?.id || 0));
  const allReady = mediaIds.length > 0 && mediaIds.every(id => id > 0) && videoStates.every(entry => entry.production?.status === 'succeeded');
  const durations = videoStates.map(entry => Number(entry.production?.media?.durationMs || 0)).filter(value => value > 0);
  const sourceDuration = durations.length === videoStates.length && durations.length
    ? durations.reduce((sum, value) => sum + value, 0) / 1000
    : videos.reduce((sum, video) => sum + Number(video.duration_sec || 0), 0);
  const mediaOptions = [{ value: 'merged', label: '最终合并', disabled: !merged }, ...videoStates.map((entry, index) => ({ value: `video:${index}`, label: String(entry.video.id).padStart(2, '0'), disabled: !entry.production?.media?.id }))];

  useEffect(() => {
    getBatchFactoryMergeCapability().then(setMergeCapability).catch(() => setMergeCapability({ ready: false, reason: '无法读取合并能力' }));
  }, []);

  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);
  useEffect(() => { setPreviewUrl(''); setTtsMeasurement(null); setMediaKey(merged ? 'merged' : 'video:0'); }, [item.id, Boolean(merged)]);

  function currentMedia() {
    if (mediaKey === 'merged') return merged;
    const index = Number(mediaKey.split(':')[1]);
    return videoStates[index]?.production?.media || null;
  }

  async function loadPreview() {
    const mediaId = Number(currentMedia()?.id || 0);
    if (!mediaId) return message.warning('当前选择还没有可预览成品');
    setPreviewLoading(true);
    try {
      const blob = await downloadMedia(mediaId);
      const url = URL.createObjectURL(blob);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = url;
      setPreviewUrl(url);
    } catch (error) {
      message.error(error.message || '加载视频预览失败');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function downloadCurrent() {
    const mediaId = Number(currentMedia()?.id || 0);
    if (!mediaId) return message.warning('当前选择没有可下载成品');
    const blob = await downloadMedia(mediaId);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = mediaKey === 'merged' ? `${item.bookId || 'batch-factory'}.mp4` : `${item.bookId || 'batch-factory'}-${mediaKey.replace(':', '-')}.mp4`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function measureNarration() {
    const text = String(batch.mode === 'viral' ? (item.approvedHookScript || item.hookDraft || item.sourceText) : item.sourceText || '').trim();
    if (!text) return message.warning('没有可用于测时的小说内容');
    setMeasuring(true);
    try {
      const config = await getConfig();
      const tts = config.tts || {};
      const blob = await textToSpeech({ input: text, voice: tts.voice || 'zh-CN-XiaoxiaoNeural', style: tts.style || 'general', speed: 1.7, pitch: tts.pitch ?? 10 });
      const measuredDurationSec = await audioDuration(blob);
      const speedRatio = sourceDuration > 0 ? sourceDuration / measuredDurationSec : 0;
      const canCompress = sourceDuration >= measuredDurationSec && speedRatio >= 1 && speedRatio <= 2;
      setTtsMeasurement({ measuredDurationSec, sourceDuration, speedRatio, canCompress });
      if (canCompress) message.success(`测时完成：${measuredDurationSec.toFixed(2)}s，自动倍率 ${speedRatio.toFixed(3)}x`);
      else if (sourceDuration < measuredDurationSec) message.warning('TTS 时长长于现有 VIDEO；第一版不自动慢放。');
      else message.warning('自动倍率超出服务端支持的 1.0x–2.0x。');
    } catch (error) {
      message.error(error.message || 'TTS 测时失败');
    } finally {
      setMeasuring(false);
    }
  }

  async function mergeVideos() {
    if (!allReady) return message.warning('请等待全部 VIDEO 生成完成');
    if (!/^\d{1,128}$/.test(String(item.bookId || ''))) return message.warning('当前书ID不能用于合并文件名');
    if (!mergeCapability?.ready) return message.warning(mergeCapability?.reason || '服务器当前不能合并视频');
    let speed = fixedSpeed;
    if (timingStrategy === 'audio') {
      if (!ttsMeasurement) return message.warning('请先测量解说时长');
      if (!ttsMeasurement.canCompress) return message.warning('当前测时结果不能直接压缩合并');
      speed = ttsMeasurement.speedRatio;
    }
    setMerging(true);
    try {
      await mergeBatchFactoryVideos({ projectId: Number(item.production.projectId), bookId: String(item.bookId), mediaIds, speed });
      message.success(`${item.bookId}.mp4 合并完成`);
      await onRefreshProduction();
      setMediaKey('merged');
    } catch (error) {
      message.error(error.message || '合并视频失败');
    } finally {
      setMerging(false);
    }
  }

  return <Space direction="vertical" size={12} style={styles.full}>
    <div><Typography.Text strong>成片预览</Typography.Text><div style={{ marginTop: 8 }}><Segmented value={mediaKey} onChange={value => { setMediaKey(value); setPreviewUrl(''); }} options={mediaOptions} /></div></div>
    <div style={styles.mediaStage}>{previewUrl ? <video controls preload="metadata" src={previewUrl} style={{ width: '100%', maxHeight: 560, background: '#000' }} /> : <Space direction="vertical" align="center"><Typography.Text style={{ color: '#bbb' }}>所有 VIDEO 和最终成品共用这个播放器</Typography.Text><Button loading={previewLoading} onClick={loadPreview}>加载当前视频</Button></Space>}</div>
    <Space wrap><Button loading={previewLoading} onClick={loadPreview}>加载 / 刷新当前视频</Button><Button onClick={downloadCurrent}>下载当前</Button></Space>
    <Divider style={{ margin: '4px 0' }} />
    <Typography.Text strong>合并成品</Typography.Text>
    <Segmented value={timingStrategy} onChange={setTimingStrategy} options={[{ value: 'fixed', label: '固定倍率' }, { value: 'audio', label: '跟随音频时长' }]} />
    {timingStrategy === 'fixed' ? <Space wrap><Typography.Text>倍率</Typography.Text><Select value={fixedSpeed} onChange={setFixedSpeed} style={{ width: 130 }} options={[1,1.1,1.2,1.3,1.5,1.7,2].map(value => ({ value, label: `${value.toFixed(1)}x` }))} /><Tag>VIDEO 总时长 {sourceDuration ? `${sourceDuration.toFixed(2)}s` : '—'}</Tag><Tag color="processing">预计 {sourceDuration ? `${(sourceDuration / fixedSpeed).toFixed(2)}s` : '—'}</Tag></Space> : <Space direction="vertical" size={8} style={styles.full}>
      <Space wrap><Tag color="blue">TTS 测时语速 1.7</Tag><Tag>仅测时，不合入音轨</Tag><Button loading={measuring} onClick={measureNarration}>测量解说时长</Button></Space>
      {ttsMeasurement ? <Space wrap><Tag>目标 {ttsMeasurement.measuredDurationSec.toFixed(2)}s</Tag><Tag>VIDEO {ttsMeasurement.sourceDuration.toFixed(2)}s</Tag><Tag color={ttsMeasurement.canCompress ? 'processing' : 'red'}>自动倍率 {ttsMeasurement.speedRatio.toFixed(4)}x</Tag></Space> : null}
      <Typography.Text type="secondary">TTS 临时音频只用于读取真实时长；最终 MP4 不混入 TTS 音轨。</Typography.Text>
    </Space>}
    {mergeCapability && !mergeCapability.ready ? <Alert type="warning" showIcon message="当前服务器不能合并" description={mergeCapability.reason} /> : null}
    <Space wrap><Button type="primary" loading={merging} disabled={!allReady || !mergeCapability?.ready} onClick={mergeVideos}>{merged ? '重新合并' : '合并视频'}</Button>{merged ? <Tag color="green">{item.bookId}.mp4 已生成</Tag> : <Tag>等待合并</Tag>}</Space>
    <Alert type="info" message="发布" description="当前分支没有独立 Batch Factory 发布 API；这里不做假发布。合并成品可继续接 qiantie 现有发布链路。" />
  </Space>;
}

export default function BatchFactoryPageV8() {
  const [activeBatch, setActiveBatch] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [productionByProject, setProductionByProject] = useState({});
  const [productionError, setProductionError] = useState('');
  const [hookEdits, setHookEdits] = useState({});
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const ids = useMemo(() => productionProjectIds(activeBatch), [activeBatch]);
  const idKey = ids.join(',');
  const selectedItem = activeBatch?.items?.find(item => item.id === selectedItemId) || activeBatch?.items?.[0] || null;
  const selectedProjectStatus = selectedItem?.production?.projectId ? productionByProject[String(selectedItem.production.projectId)] || null : null;

  async function refreshHistory() {
    setHistoryLoading(true);
    try {
      const result = await listBatchFactoryBatches();
      setHistory(result.batches || []);
    } catch (error) {
      message.error(error.message || '读取批次失败');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadBatch(batchId) {
    try {
      const result = await getBatchFactoryBatch(batchId);
      setActiveBatch(result.batch);
      setSelectedItemId(current => result.batch?.items?.some(item => item.id === current) ? current : (result.batch?.items?.[0]?.id || ''));
      const edits = {};
      for (const item of result.batch?.items || []) if (item.hookDraft) edits[item.id] = item.approvedHookScript || item.hookDraft;
      setHookEdits(edits);
    } catch (error) {
      message.error(error.message || '读取批次失败');
    }
  }

  async function refreshActiveBatch() {
    if (activeBatch?.id) await loadBatch(activeBatch.id);
  }

  async function refreshProduction() {
    if (!ids.length) {
      setProductionByProject({});
      setProductionError('');
      return;
    }
    try {
      const result = await getBatchFactoryProductionStatus(ids);
      setProductionByProject(Object.fromEntries((result.projects || []).map(project => [String(project.projectId), project])));
      setProductionError('');
    } catch (error) {
      setProductionError(error.message || '读取生产状态失败');
    }
  }

  useEffect(() => { refreshHistory(); }, []);
  useEffect(() => {
    if (!activeBatch?.id || !activeBatch.items?.some(item => ACTIVE_AI_STATUSES.has(item.status))) return undefined;
    const timer = window.setInterval(() => refreshActiveBatch().catch(() => {}), 2500);
    return () => window.clearInterval(timer);
  }, [activeBatch?.id, activeBatch?.items]);
  useEffect(() => {
    refreshProduction();
    if (!ids.length) return undefined;
    const timer = window.setInterval(refreshProduction, 3000);
    return () => window.clearInterval(timer);
  }, [idKey]);

  const statusRows = useMemo(() => (activeBatch?.items || []).map(item => {
    const projectStatus = item.production?.projectId ? productionByProject[String(item.production.projectId)] : null;
    return { item, status: resolveBookStatus(item, projectStatus) };
  }), [activeBatch, productionByProject]);
  const statusCounts = useMemo(() => statusRows.reduce((result, row) => { result[row.status] = (result[row.status] || 0) + 1; return result; }, {}), [statusRows]);
  const filteredRows = statusFilter === 'all' ? statusRows : statusRows.filter(row => row.status === statusFilter);
  const selectedStatusMeta = BOOK_STATUS_META.find(meta => meta.key === statusFilter) || BOOK_STATUS_META[0];

  async function saveDirector(directorResult, successText) {
    if (!selectedItem || !activeBatch) return;
    try {
      await updateBatchFactoryDirectorResult(activeBatch.id, selectedItem.id, directorResult);
      await refreshActiveBatch();
      message.success(successText || '修改已保存');
    } catch (error) {
      message.error(error.message || '保存失败');
    }
  }

  async function approveHook() {
    const text = String(hookEdits[selectedItem.id] ?? selectedItem.hookDraft ?? '').trim();
    if (!text) return message.warning('爆款开头不能为空');
    try {
      await approveBatchFactoryHook(activeBatch.id, selectedItem.id, text);
      await refreshActiveBatch();
      message.success('爆款开头已锁定，开始导演');
    } catch (error) {
      message.error(error.message || '审核失败');
    }
  }

  async function bulkGenerate() {
    if (!activeBatch?.settings?.videoModelId) return message.warning('当前批次没有绑定视频模型');
    setBulkSubmitting(true);
    try {
      const result = await generateBatchFactoryBatch(activeBatch.id, Number(activeBatch.settings.videoModelId));
      message.success(`已提交 ${result.succeededItems || 0} 本，${result.queuedVideos || 0} 个 VIDEO`);
      await refreshActiveBatch();
      await refreshProduction();
    } catch (error) {
      message.error(error.message || '整批提交失败');
    } finally {
      setBulkSubmitting(false);
    }
  }

  if (!activeBatch) return <div style={styles.page}><Space direction="vertical" size={14} style={styles.full}>
    <SetupView onOpened={loadBatch} />
    <Card title="历史批次" extra={<Button onClick={refreshHistory}>刷新</Button>}>
      {historyLoading ? <Spin /> : history.length ? <List dataSource={history} renderItem={batch => <List.Item actions={[<Button key="open" onClick={() => loadBatch(batch.id)}>打开</Button>]}><List.Item.Meta title={batch.name} description={`${batch.mode === 'viral' ? '爆款开头' : '原文直转'} · ${batch.settings?.videoModelName || '未记录模型'} · ${batch.total} 本`} /></List.Item>} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无批次" />}
    </Card>
  </Space></div>;

  return <div style={styles.page}><Space direction="vertical" size={14} style={styles.full}>
    <Card><Space wrap><Typography.Title level={4} style={{ margin: 0 }}>{activeBatch.name}</Typography.Title><Tag color="blue">{activeBatch.settings?.videoModelName || '未记录模型'}</Tag><Tag>{activeBatch.settings?.aspectRatio || '9:16'}</Tag><Tag>{activeBatch.mode === 'viral' ? '爆款开头' : '原文直转'}</Tag><Button onClick={() => setActiveBatch(null)}>返回批次列表</Button><Button onClick={refreshActiveBatch}>刷新</Button></Space></Card>

    <div style={styles.statusGrid}>
      <Card title="批次状态中心" extra={<Typography.Text type="secondary">按小说计数 · 点击筛选</Typography.Text>}>
        <Space wrap>{BOOK_STATUS_META.map(meta => <Button key={meta.key} type={statusFilter === meta.key ? 'primary' : 'default'} danger={meta.key === 'failed'} onClick={() => setStatusFilter(meta.key)}>{meta.label} {meta.key === 'all' ? statusRows.length : (statusCounts[meta.key] || 0)}</Button>)}</Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>状态中心只负责筛选；结果固定显示在右侧“当前筛选”。</Typography.Paragraph>
      </Card>
      <Card title="当前筛选" extra={<Tag color={selectedStatusMeta.color}>{selectedStatusMeta.label} · {filteredRows.length} 本</Tag>}>
        <div style={styles.filterList}>{filteredRows.length ? filteredRows.map((row, index) => <div key={row.item.id} style={{ ...styles.filterRow, borderBottom: index === filteredRows.length - 1 ? 'none' : styles.filterRow.borderBottom }} onClick={() => setSelectedItemId(row.item.id)}><Space wrap><Typography.Text strong>{row.item.title}</Typography.Text>{row.item.bookId ? <Tag>书ID {row.item.bookId}</Tag> : null}{bookStatusTag(row.status)}{row.item.manuallyEdited ? <Tag color="purple">已手动修改</Tag> : null}</Space></div>) : <div style={{ padding: 18 }}><Typography.Text type="secondary">当前没有小说</Typography.Text></div>}</div>
      </Card>
    </div>

    {productionError ? <Alert type="warning" showIcon message="生产状态读取失败" description={productionError} /> : null}

    {selectedItem ? <div style={styles.blocks}>
      <Card title="1. 小说 / 剧情" extra={<Space wrap>{selectedItem.bookId ? <Tag>书ID {selectedItem.bookId}</Tag> : null}{bookStatusTag(resolveBookStatus(selectedItem, selectedProjectStatus))}</Space>}>
        <Space direction="vertical" size={10} style={styles.full}>
          <Space wrap>{selectedItem.sourceTaskId ? <Tag>小说获取任务 #{selectedItem.sourceTaskId}</Tag> : <Tag>手动导入</Tag>}{selectedItem.platform ? <Tag color="blue">{selectedItem.platform}</Tag> : null}{selectedItem.txtFileName ? <Tag>{selectedItem.txtFileName}</Tag> : null}</Space>
          <Collapse items={[{ key: 'source', label: '小说原文', children: <Input.TextArea rows={10} readOnly value={selectedItem.sourceText || ''} /> }]} />
          {activeBatch.mode === 'viral' && selectedItem.hookDraft ? <Card size="small" title="爆款开头"><Space direction="vertical" size={8} style={styles.full}><Input.TextArea rows={8} readOnly={selectedItem.status !== 'hook_review'} value={hookEdits[selectedItem.id] ?? selectedItem.approvedHookScript ?? selectedItem.hookDraft} onChange={event => setHookEdits(current => ({ ...current, [selectedItem.id]: event.target.value }))} />{selectedItem.status === 'hook_review' ? <Space wrap><Button onClick={async () => { try { await rewriteBatchFactoryHook(activeBatch.id, selectedItem.id); await refreshActiveBatch(); } catch (error) { message.error(error.message || '重新改编失败'); } }}>重新改编</Button><Button type="primary" onClick={approveHook}>通过并导演</Button></Space> : <Tag color="green">已锁定</Tag>}</Space></Card> : null}
          {selectedItem.status === 'failed' ? <Alert type="error" showIcon message="当前制作阶段失败" description={selectedItem.error} /> : null}
          {selectedItem.directorResult ? <Button onClick={async () => { try { await regenerateBatchFactoryDirector(activeBatch.id, selectedItem.id); await refreshActiveBatch(); } catch (error) { message.error(error.message || '重新导演失败'); } }}>重新导演当前小说</Button> : null}
        </Space>
      </Card>

      <Card title="2. 人物 / 场景 / 道具" extra={<Typography.Text type="secondary">直接编辑，不进入提示词工作室</Typography.Text>}><AssetSection item={selectedItem} onSave={saveDirector} /></Card>

      <Card title="3. VIDEO" extra={<Tag>第三块固定 VIDEO</Tag>}><VideoSection batch={activeBatch} item={selectedItem} projectStatus={selectedProjectStatus} onSaveDirector={saveDirector} onRefresh={async () => { await refreshActiveBatch(); await refreshProduction(); }} onBulkGenerate={bulkGenerate} bulkSubmitting={bulkSubmitting} /></Card>

      <Card title="4. 合并成品 / 发布" extra={<Typography.Text type="secondary">统一播放器</Typography.Text>}>
        {selectedItem.production?.projectId ? <MediaMergeSection batch={activeBatch} item={selectedItem} projectStatus={selectedProjectStatus} onRefreshProduction={refreshProduction} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="生成 VIDEO 后在这里统一预览和合并" />}
      </Card>
    </div> : <Empty description="当前批次没有小说" />}
  </Space></div>;
}
