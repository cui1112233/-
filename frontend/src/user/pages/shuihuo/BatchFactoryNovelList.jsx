import {
  ArrowLeftOutlined,
  BarsOutlined,
  CloudUploadOutlined,
  FileTextOutlined,
  FullscreenOutlined,
  PictureOutlined,
  SettingOutlined,
  UploadOutlined
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Dropdown,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Tooltip,
  message
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import {
  createPrompt,
  createPublishIntent,
  getCapabilities,
  getConfigVersions,
  getFinalPrompt,
  getDraft,
  getMergeStatus,
  getProductionStatus,
  getPublishCredential,
  getChangeImpact,
  rewriteWorkingFront,
  runBatchDirector,
  runDirector,
  saveBatchSettings,
  saveDraft,
	  saveVideoOverride,
  submitBatchMerge,
  submitBatchProduction,
  submitBookProduction
} from '../../../shared/api/batchFactoryV11';
import { BatchFactoryEngineSettingsDrawer } from './BatchFactoryEngineSettingsDrawer';
import { BatchFactoryAiReasoningModal } from './BatchFactoryAiReasoningModal';
import { batchFactoryBookState, batchFactoryNovelTableRow } from './batchFactoryBookState';
import { batchFactoryPreviewText, contentRangeLinesForBook, publishContentWithWorkingFront } from './batchFactoryContentRange';
import { getWorkshopPlatforms } from '../../../shared/api/novelFetchWorkshop';
import { batchFactoryPlatformOptions } from './batchFactoryPlatformOptions';

function value(metadata, key) { return String(metadata?.[key] || '').trim() || '—'; }
function bookPlatformName(book, platformNames = {}) {
  const metadata = book?.sourceMetadata || {};
  return String(metadata.platformName || metadata.platformLabel || platformNames[String(book?.platform || '')] || '').trim() || '未命名书城';
}
function resultData(result, key) { return result?.[key] || result || {}; }
function requestID(prefix) { return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`; }
function capability(caps, key) { return caps?.[key] || { available: false, reason: '正在读取 V11 服务能力' }; }
function assetName(asset) { return String(asset?.name || asset?.label || asset?.id || '未命名预设'); }
function assetPrompt(asset) { return String(asset?.prompt || asset?.visualPrompt || asset?.description || ''); }
function savedDraftKey(type, asset) { return `asset:${type}:${asset?.id || assetName(asset)}`; }
function completedMediaVersions(status) {
	const entries = new Map();
	for (const job of status?.jobs || []) for (const task of job?.tasks || []) {
		if (task?.status !== 'succeeded' || !String(task?.mediaUrl || '').trim()) continue;
		const versions = entries.get(task.videoId) || [];
		versions.push({ ...task, productionJobId: job.id });
		entries.set(task.videoId, versions);
	}
	return entries;
}

function primaryMediaVersion(video, versions) {
	const primaryID = video?.settingsState?.patch?.primaryMediaTaskId;
	return versions.find(item => item.id === primaryID) || versions.at(-1) || null;
}

function NovelMetadata({ books, createdAt, selectedBookIds, onSelectionChange, onViewBook, platformNames }) {
  const selected = new Set(selectedBookIds);
  const allSelected = books.length > 0 && books.every(book => selected.has(book.id));
  return <div className="batch-factory-novel-list batch-factory-novel-fetch-list" role="table" aria-label="小说列表">
    <div className="batch-factory-novel-list-head" role="row"><span>推送日期</span><span><Checkbox checked={allSelected} onChange={event => onSelectionChange(event.target.checked ? books.map(book => book.id) : [])} aria-label="全选小说" /></span><span>ID</span><span>书名</span><span>书城</span><span>风格</span><span>男女频</span><span>标签</span><span>推荐理由</span><span>评级</span><span>AI判断</span><span>原文</span><span>AI文案</span><span>网站提交</span><span>状态</span><span>操作</span></div>
    {books.map((book, index) => {
      const row = batchFactoryNovelTableRow(book, index, createdAt);
      const metadata = book.sourceMetadata || {};
      return <div className="batch-factory-novel-list-row" key={book.id} role="row">
        <span>{row.createdAt}</span><span><Checkbox checked={selected.has(book.id)} onChange={event => onSelectionChange(event.target.checked ? [...selected, book.id] : [...selected].filter(id => id !== book.id))} aria-label={`选择 ${row.title}`} /></span><span className="batch-factory-book-id">{row.bookId}</span><strong title={row.title}>{row.title}</strong><span>{bookPlatformName(book, platformNames)}</span><span>{value(metadata, 'style')}</span><span>{value(metadata, 'gender')}</span><span>{value(metadata, 'tags')}</span><span>{value(metadata, 'reason')}</span><span>{value(metadata, 'rating')}</span><span>{metadata.classifyStatus || '—'}</span><span className={row.original === '✓' ? 'is-ready' : ''}>{row.original}</span><span>{row.ai1}</span><span>{row.websiteSubmit}</span><span className={row.status === '定时待执行' ? 'is-scheduled' : ''}>{row.status}</span><span><Button size="small" onClick={() => onViewBook(book)}>查看</Button></span>
      </div>;
    })}
  </div>;
}

function AssetEditor({ book, batchId, onSaved, onGenerate, canGenerate, generateReason, generating, engineSettings }) {
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');
  const [libraryTab, setLibraryTab] = useState('character');
  const [search, setSearch] = useState('');
  const groups = [
    ['character', '人物', book?.assets?.characters || []],
    ['scene', '场景', book?.assets?.scenes || []],
    ['prop', '道具', book?.assets?.props || []]
  ];
  const tabs = [
    ['character', 'AI角色'], ['scene', 'AI场景'], ['prop', 'AI道具'], ['voice', 'AI音色'],
    ['character-library', '角色库'], ['scene-library', '场景库'], ['voice-library', '音色库']
  ];
  const promptAssets = groups.flatMap(([type, label, items]) => items.map(asset => ({ type, label, asset }))).filter(({ type, asset }) => {
    const matchesType = filter === 'all' || filter === type;
    const query = search.trim().toLowerCase();
    return matchesType && (!query || `${assetName(asset)} ${assetPrompt(asset)}`.toLowerCase().includes(query));
  });
  useEffect(() => {
    const initial = {};
    for (const [type, , items] of groups) for (const item of items) initial[`${type}:${savedDraftKey(type, item)}`] = assetPrompt(item);
    setDrafts(initial);
    setFilter('all');
    setSearch('');
  }, [book?.id]);
  async function save() {
    setSaving(true);
    try {
      await Promise.all(groups.flatMap(([type, , items]) => items.map(asset => saveDraft({ key: savedDraftKey(type, asset), kind: 'asset-prompt', scope: batchId, content: drafts[`${type}:${savedDraftKey(type, asset)}`] ?? '' }))));
      message.success('当前小说的预设 Prompt 已保存');
      await onSaved?.();
    } catch (error) { message.error(error?.message || '保存预设 Prompt 失败'); } finally { setSaving(false); }
  }
  const noImageReason = 'V11 尚未提供该书的资产图片接口，不能伪造生成、上传或替换成功。';
  return <section className="batch-factory-preset-shell">
    <Alert type="info" showIcon message="当前小说的人物场景预设" description="左侧只编辑该书真实的 AI 资产 Prompt；“智能预设”会执行该书 AI 推理。图片库只展示真实图片，接口接入前不会显示占位假图。" />
    <div className="shuihuo-preset-toolbar batch-factory-preset-toolbar">
      <Tooltip title="由当前批量的引擎配置决定"><Select disabled value={engineSettings?.textModelId || undefined} placeholder="未设置文本模型" options={engineSettings?.textModelId ? [{ value: engineSettings.textModelId, label: engineSettings.textModelId }] : []} /></Tooltip>
      <Select disabled value="人物场景、道具" options={[{ value: '人物场景、道具', label: '人物场景、道具提取提示词' }]} />
      <Tooltip title={canGenerate ? '执行当前小说的真实 AI 推理并回写资产' : generateReason}><Button type="primary" loading={generating} disabled={!canGenerate || generating} onClick={onGenerate}>智能预设</Button></Tooltip>
      <Tooltip title="由当前批量的引擎配置决定"><Select disabled value={engineSettings?.imageModelId || undefined} placeholder="未设置图片模型" options={engineSettings?.imageModelId ? [{ value: engineSettings.imageModelId, label: engineSettings.imageModelId }] : []} /></Tooltip>
      <Select disabled value={engineSettings?.aspectRatio || '9:16'} options={[{ value: engineSettings?.aspectRatio || '9:16', label: engineSettings?.aspectRatio || '9:16' }]} />
      <Button disabled title="风格设置由当前批量的引擎配置统一管理">选择风格</Button>
      <Select disabled value="人物设定" options={[{ value: '人物设定', label: '人物设定（仅角色）' }]} />
      <Tooltip title={noImageReason}><Button disabled>AI生成（已选 0）</Button></Tooltip>
      <Tooltip title="V11 尚未提供把手动新增资产写入导演资产并绑定分镜的接口。"><Button disabled>手动添加</Button></Tooltip>
    </div>
    <div className="shuihuo-preset-layout batch-factory-preset-layout">
      <aside className="shuihuo-preset-list">
        <div className="shuihuo-preset-list-head"><strong>预设列表 ({promptAssets.length})</strong><Select size="small" value={filter} onChange={setFilter} options={[{ value: 'all', label: '全部' }, ...groups.map(([type, label]) => ({ value: type, label }))]} /><Button type="text" danger size="small" onClick={() => { setFilter('all'); setSearch(''); }}>清空</Button></div>
        <div className="shuihuo-prompt-list">
          {promptAssets.map(({ type, label, asset }) => <article className="shuihuo-prompt-row" key={`${type}:${savedDraftKey(type, asset)}`}>
            <div className="shuihuo-prompt-row-head"><Tag>{label}</Tag><strong>{assetName(asset)}</strong></div>
            <Input.TextArea rows={4} value={drafts[`${type}:${savedDraftKey(type, asset)}`] ?? ''} onChange={event => setDrafts(current => ({ ...current, [`${type}:${savedDraftKey(type, asset)}`]: event.target.value }))} placeholder="输入该资产的视觉提示词" />
          </article>)}
          {!promptAssets.length ? <div className="shuihuo-prompt-empty"><b>＋</b><p>暂无真实预设。先点击“智能预设”生成当前小说的人物、场景与道具。</p></div> : null}
        </div>
      </aside>
      <main className="shuihuo-preset-library">
        <div className="shuihuo-asset-tabs">{tabs.map(([value, label]) => <button type="button" className={libraryTab === value ? 'active' : ''} onClick={() => setLibraryTab(value)} key={value}>{label}</button>)}</div>
        <Input.Search value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索人物、场景或道具提示词..." className="shuihuo-preset-search" allowClear />
        <div className="shuihuo-image-library-grid"><div className="shuihuo-image-empty"><b>图片库</b><p>V11 尚未提供该书的资产图片接口</p><span>人物、场景、道具 Prompt 可在左侧编辑并保存；接入真实图片接口后，这里才会显示、上传和替换实际图片。</span></div></div>
      </main>
    </div>
    <div className="batch-factory-modal-actions"><Button type="primary" loading={saving} onClick={save} disabled={!groups.some(([, , items]) => items.length)}>保存预设 Prompt</Button></div>
  </section>;
}

function PromptPanel({ book, batchId, onSaved }) {
  const [selectedVideoId, setSelectedVideoId] = useState(book?.videos?.[0]?.id || '');
  const [loading, setLoading] = useState(false);
	  const [saving, setSaving] = useState(false);
  const [prompt, setPrompt] = useState(null);
	  const [videoPrompt, setVideoPrompt] = useState('');
	  const [visualPrompt, setVisualPrompt] = useState('');
  const videos = book?.videos || [];
	  const selectedVideo = videos.find(video => video.id === selectedVideoId) || null;
	  useEffect(() => {
		  const first = book?.videos?.[0] || null;
		  setSelectedVideoId(first?.id || '');
		  setVideoPrompt(first?.videoPrompt || '');
		  setVisualPrompt(first?.visualPrompt || '');
		  setPrompt(null);
	  }, [book?.id]);
	  useEffect(() => {
		  setVideoPrompt(selectedVideo?.videoPrompt || '');
		  setVisualPrompt(selectedVideo?.visualPrompt || '');
		  setPrompt(null);
	  }, [selectedVideoId]);
  async function loadPrompt() {
    if (!selectedVideoId) return;
    setLoading(true);
    try { setPrompt(resultData(await getFinalPrompt(batchId, book.id, selectedVideoId), 'prompt')); } catch (error) { message.error(error?.message || '读取最终提示词失败'); } finally { setLoading(false); }
  }
	  async function savePrompts() {
		  if (!selectedVideo) return;
		  setSaving(true);
		  try {
			  await saveVideoOverride(batchId, book.id, selectedVideo.id, { patch: { videoPrompt, visualPrompt }, expectedRevision: Number(selectedVideo.revision || 0) });
			  await onSaved?.();
			  message.success('当前 VIDEO 的视频提示词和画面提示词已分别保存。');
		  } catch (error) { message.error(error?.message || '保存 VIDEO 提示词失败'); } finally { setSaving(false); }
	  }
	  return <Space direction="vertical" size={12} style={{ width: '100%' }}><Space wrap><Select value={selectedVideoId || undefined} onChange={setSelectedVideoId} style={{ minWidth: 210 }} placeholder="选择分镜 / VIDEO" options={videos.map(video => ({ value: video.id, label: video.label || video.id }))} /><Button onClick={loadPrompt} loading={loading} disabled={!selectedVideoId}>读取最终视频提示词</Button></Space><label className="shuihuo-form-label">视频提示词<Input.TextArea rows={5} value={videoPrompt} onChange={event => setVideoPrompt(event.target.value)} placeholder="这段文字会进入 VIDEO 的最终编译" /></label><label className="shuihuo-form-label">画面提示词<Input.TextArea rows={5} value={visualPrompt} onChange={event => setVisualPrompt(event.target.value)} placeholder="仅用于生成当前 VIDEO 的画面图片，不会进入视频提示词" /></label><Button type="primary" loading={saving} disabled={!selectedVideo} onClick={savePrompts}>保存当前 VIDEO 提示词</Button>{prompt ? <pre className="batch-factory-final-prompt">{prompt?.compiledPrompt || prompt?.compiled || prompt?.content || JSON.stringify(prompt, null, 2)}</pre> : <p className="shuihuo-modal-note">AI 推理完成后，每个 VIDEO 的最终视频提示词由 V11 编译器实时生成；画面提示词仅服务画面图。</p>}</Space>;
}

function MediaVersionPanel({ book, batchId, versionsByVideo, onSaved }) {
	const videos = book?.videos || [];
	const [selectedVideoId, setSelectedVideoId] = useState(videos[0]?.id || '');
	const [savingTaskId, setSavingTaskId] = useState('');
	useEffect(() => { setSelectedVideoId(book?.videos?.[0]?.id || ''); }, [book?.id]);
	const selectedVideo = videos.find(video => video.id === selectedVideoId) || null;
	const versions = selectedVideo ? (versionsByVideo.get(selectedVideo.id) || []) : [];
	const primary = primaryMediaVersion(selectedVideo, versions);
	const candidates = versions.filter(version => version.id !== primary?.id).slice(-4).reverse();
	async function choosePrimary(version) {
		if (!selectedVideo || !version || savingTaskId) return;
		setSavingTaskId(version.id);
		try {
			await saveVideoOverride(batchId, book.id, selectedVideo.id, { patch: { primaryMediaTaskId: version.id }, expectedRevision: Number(selectedVideo.revision || 0) });
			await onSaved?.();
			message.success('已切换当前分镜的主版本；下一次合并会读取它。');
		} catch (error) { message.error(error?.message || '切换主版本失败'); } finally { setSavingTaskId(''); }
	}
	return <Space direction="vertical" size={14} style={{ width: '100%' }}><Alert type="info" showIcon message="当前分镜的主版本与候选版本" description="主版本是下一次合并唯一读取的 VIDEO；候选仅用于回退。重新生成成功后会出现新的版本。" /><Select value={selectedVideoId || undefined} onChange={setSelectedVideoId} placeholder="选择分镜 / VIDEO" options={videos.map(video => ({ value: video.id, label: video.label || video.id }))} style={{ width: 280 }} />{primary ? <section className="batch-factory-media-primary"><b>主版本</b><span>{primary.id} · {primary.updatedAt || primary.createdAt || '已完成'}</span><a href={primary.mediaUrl} target="_blank" rel="noreferrer">打开视频</a></section> : <p className="shuihuo-modal-note">当前 VIDEO 还没有真实成功的视频版本。</p>}<div className="batch-factory-media-candidates">{Array.from({ length: 4 }).map((_, index) => { const version = candidates[index]; return version ? <article key={version.id}><b>候选 {index + 1}</b><span>{version.id}</span><a href={version.mediaUrl} target="_blank" rel="noreferrer">打开视频</a><Button size="small" loading={savingTaskId === version.id} onClick={() => choosePrimary(version)}>切换为主版本</Button></article> : <article className="is-empty" key={`empty-${index}`}><PictureOutlined /><span>候选槽 {index + 1}</span></article>; })}</div></Space>;
}

function BatchLogs({ productionStatus, mergeStatus, error }) {
  const jobs = productionStatus?.jobs || [];
  const merges = mergeStatus?.jobs || [];
  return <><Alert type={error ? 'warning' : 'info'} showIcon message={error || '实时读取 V11 生产与合并状态'} description="数据来自当前批次的生产状态和合并状态接口；刷新不会提交新任务。" />
    <div className="batch-factory-log-list">{jobs.map(job => <section key={job.id}><strong>生成任务 · {job.status}</strong><span>{job.bookId || '批量任务'} · {job.updatedAt || job.createdAt || '—'}</span>{(job.tasks || []).map(task => <p key={task.id}>{task.videoId} · {task.status}{task.errorMessage ? ` · ${task.errorMessage}` : ''}</p>)}</section>)}{merges.map(job => <section key={job.id}><strong>合并任务 · {job.status}</strong><span>{job.updatedAt || job.createdAt || '—'}</span><p>{job.outputUrl || job.errorMessage || '等待合并结果'}</p></section>)}{!jobs.length && !merges.length ? <p>当前没有生产或合并任务。</p> : null}</div>
  </>;
}

function UploadNetwork({ batch, books, selectedBookIds, capabilities, productionStatus, mergeStatus, mode, onClose }) {
  const [credential, setCredential] = useState(null);
  const [intent, setIntent] = useState(null);
  const [busy, setBusy] = useState(false);
  const publishCapability = capability(capabilities, 'publish.121');
  const targetBooks = mode === 'all' ? books : books.filter(book => selectedBookIds.includes(book.id));
  const mergeReady = (mergeStatus?.jobs || []).some(job => job?.status === 'succeeded' && String(job?.outputUrl || '').trim());
  useEffect(() => {
    if (!mode) return;
    setIntent(null);
    if (!publishCapability.available) {
      setCredential(null);
      return;
    }
    getPublishCredential('121').then(result => setCredential(resultData(result, 'credential'))).catch(() => setCredential(null));
  }, [mode, publishCapability.available]);
  async function createIntent() {
    setBusy(true);
    try {
      const rewriteEnabled = batch?.settingsState?.patch?.publishRewriteEnabled === true;
      const publishBooks = targetBooks.map(book => ({
        id: book.id, bookId: book.bookId, title: book.title, platform: book.platform,
        sourceText: rewriteEnabled ? publishContentWithWorkingFront(book.sourceText, book.workingFrontContent, book) : book.sourceText
      }));
      const result = await createPublishIntent('121', {
        batchId: batch.id,
        bookId: targetBooks.length === 1 ? targetBooks[0].id : '',
        payload: {
          batchId: batch.id,
          books: publishBooks,
          publishSettings: batch?.settingsState?.patch?.publishSettings || {}
        }
      });
      setIntent(resultData(result, 'intent'));
      message.success('121 发布确认单已生成。确认单不会自动提交。');
    } catch (error) { message.error(error?.message || '生成 121 发布确认单失败'); } finally { setBusy(false); }
  }
  return <Modal title={`上传网络 · ${mode === 'all' ? '提交全部' : '提交选中'}`} open={Boolean(mode)} onCancel={onClose} footer={null} width={700} destroyOnClose>
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Alert type="info" showIcon message={`已选择 ${targetBooks.length} 本小说`} description="这里创建的是 121 发布确认单。真实外部提交必须由用户在确认单上再次点击确认，页面不会自动上传。" />
      {!publishCapability.available ? <Alert type="warning" showIcon message="121 通道当前不可用" description={publishCapability.reason || 'V11 服务未启用 121 发布能力'} /> : null}
      {!mergeReady ? <Alert type="warning" showIcon message="尚无成功的批量合并成片" description="121 确认单会检查 V11 合并结果；不会把空视频或未完成视频提交到外部。" /> : null}
      <Tag color={credential?.configured ? 'green' : 'default'}>{credential?.configured ? `121 账号已配置：${credential.name || '已配置'}` : '121 账号尚未在个人中心或管理端配置'}</Tag>
      <Button type="primary" onClick={createIntent} loading={busy} disabled={!targetBooks.length || !publishCapability.available || !credential?.configured || !mergeReady}>生成 121 发布确认单</Button>
      {intent ? <Alert type="success" showIcon message={`确认单 ${intent.id || '已创建'}`} description="确认单已经锁定本次选择与媒体条件。为了避免在开发过程中误发到 121，此页面只生成确认单；实际提交按钮会在下一步的确认流程中显示。" /> : null}
    </Space>
  </Modal>;
}

export function BatchFactoryNovelList({ batch, onBack, onBatchChanged }) {
  const [novelListOpen, setNovelListOpen] = useState(false);
  const [viewingBook, setViewingBook] = useState(null);
  const [assetBook, setAssetBook] = useState(null);
  const [editingContentBook, setEditingContentBook] = useState(null);
  const [editingContentValue, setEditingContentValue] = useState('');
  const [viralCandidate, setViralCandidate] = useState('');
  const [contentSaving, setContentSaving] = useState(false);
  const [rewritingFront, setRewritingFront] = useState(false);
	const [promptBook, setPromptBook] = useState(null);
	const [mediaBook, setMediaBook] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [engineOpen, setEngineOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [productionStatus, setProductionStatus] = useState(null);
  const [mergeStatus, setMergeStatus] = useState(null);
  const [capabilities, setCapabilities] = useState({});
  const [configVersions, setConfigVersions] = useState([]);
  const [configVersionsError, setConfigVersionsError] = useState(null);
  const [actionBusy, setActionBusy] = useState('');
  const [uploadMode, setUploadMode] = useState('');
  const [selectedBookIds, setSelectedBookIds] = useState([]);
  const [platformNames, setPlatformNames] = useState({});
  const books = Array.isArray(batch?.books) ? batch.books : [];
  const readyBooks = books.filter(book => String(book?.sourceText || '').trim()).length;
  const progress = books.length ? Math.round((readyBooks / books.length) * 100) : 0;
	const mediaVersionsByVideo = useMemo(() => completedMediaVersions(productionStatus), [productionStatus]);
  const totalVideos = books.reduce((count, book) => count + (book?.videos?.length || 0), 0);
  const runCapability = capability(capabilities, 'director.run');
  const workingFrontCapability = capability(capabilities, 'working-front.viral');
  const productionCapability = capability(capabilities, 'production.submit');
  const mergeCapability = capability(capabilities, 'merge.run');

  async function refreshBatch() {
    await onBatchChanged?.();
  }
  async function loadRuntimeStatus({ quiet = false, runtimeCapabilities = capabilities } = {}) {
    if (!batch?.id) return;
    const productionEnabled = capability(runtimeCapabilities, 'production.submit').available;
    const mergeEnabled = capability(runtimeCapabilities, 'merge.run').available;
    if (!productionEnabled && !mergeEnabled) {
      setProductionStatus({ batchId: batch.id, jobs: [] });
      setMergeStatus({ batchId: batch.id, jobs: [] });
      setLogsError('');
      return;
    }
    setLogsLoading(true);
    try {
      const [production, merge] = await Promise.all([
        productionEnabled ? getProductionStatus(batch.id) : Promise.resolve({ batchId: batch.id, jobs: [] }),
        mergeEnabled ? getMergeStatus(batch.id) : Promise.resolve({ batchId: batch.id, jobs: [] })
      ]);
      setProductionStatus(production);
      setMergeStatus(merge);
      setLogsError('');
    } catch (error) {
      const text = error?.message || '读取任务状态失败';
      setLogsError(text);
      if (!quiet) message.error(text);
    } finally { setLogsLoading(false); }
  }
  useEffect(() => {
    if (!batch?.id) return;
    let active = true;
    Promise.all([getCapabilities(), getConfigVersions()]).then(async ([nextCapabilities, nextVersions]) => {
      if (!active) return;
      setCapabilities(nextCapabilities || {});
      setConfigVersions(resultData(nextVersions, 'versions') || []);
      setConfigVersionsError(null);
      await loadRuntimeStatus({ quiet: true, runtimeCapabilities: nextCapabilities || {} });
    }).catch(error => { if (active) setConfigVersionsError(error); });
    return () => { active = false; };
  }, [batch?.id]);
  useEffect(() => {
    let active = true;
    getWorkshopPlatforms().then(result => {
      if (!active) return;
      setPlatformNames(Object.fromEntries(batchFactoryPlatformOptions(result?.platforms).map(option => [String(option.value), option.label])));
    }).catch(() => { if (active) setPlatformNames({}); });
    return () => { active = false; };
  }, []);
  useEffect(() => { setSelectedBookIds(current => current.filter(id => books.some(book => book.id === id))); }, [batch?.id, books.length]);
  useEffect(() => {
    if (!assetBook) return;
    const refreshed = books.find(book => book.id === assetBook.id);
    if (refreshed && refreshed !== assetBook) setAssetBook(refreshed);
  }, [batch?.id, assetBook?.id]);

  async function openContentEditor(book) {
    setEditingContentBook(book);
    setEditingContentValue(book?.workingFrontContent || batchFactoryPreviewText(book?.sourceText, book));
    setViralCandidate('');
    try {
      const result = await getDraft({ key: `working-front-candidate:${book.id}`, kind: 'working-front-viral-candidate', scope: batch.id }, { suppressGlobalError: true });
      setViralCandidate(String(resultData(result, 'draft')?.content || ''));
    } catch (error) {
      if (error?.status && error.status !== 404) message.error(error?.message || '读取爆款候选失败');
    }
  }
  async function saveWorkingContent() {
    if (!editingContentBook) return;
    setContentSaving(true);
    try {
      await saveDraft({ key: `working-front:${editingContentBook.id}`, kind: 'working-front-content', scope: batch.id, content: editingContentValue.trim() });
      await refreshBatch();
      setEditingContentBook(null);
      message.success('当前小说的生产内容已保存；原文不会被覆盖。');
    } catch (error) { message.error(error?.message || '保存生产内容失败'); } finally { setContentSaving(false); }
  }
  async function createViralCandidate() {
    if (!editingContentBook || rewritingFront) return;
    setRewritingFront(true);
    try {
      const result = await rewriteWorkingFront(batch.id, editingContentBook.id, editingContentValue);
      const candidate = String(resultData(result, 'candidate') || '').trim();
      setViralCandidate(candidate);
      message.success('爆款候选已生成，请确认后再替换当前生产内容。');
    } catch (error) { message.error(error?.message || '生成爆款候选失败'); } finally { setRewritingFront(false); }
  }
  async function runAi(scope) {
    if (!batch?.id || actionBusy) return;
    setActionBusy('director');
    try {
      if (scope === 'all') await runBatchDirector(batch.id);
      else if (scope?.id) await runDirector(batch.id, scope.id);
      await refreshBatch();
      message.success(scope === 'all' ? '批量 AI 推理已提交并回读当前作品。' : '当前小说 AI 推理已完成并回读当前作品。');
      setAiOpen(false);
    } catch (error) { message.error(error?.message || 'AI 推理失败'); } finally { setActionBusy(''); }
  }
  async function runProduction(book = null) {
    if (!batch?.id || actionBusy) return;
    setActionBusy('production');
    try {
      const provider = batch?.settingsState?.patch?.videoProvider || 'personal_api';
      if (book) await submitBookProduction(batch.id, book.id, requestID('bf11-book-production'), provider);
      else await submitBatchProduction(batch.id, requestID('bf11-batch-production'), provider);
      await Promise.all([refreshBatch(), loadRuntimeStatus({ quiet: true })]);
      message.success(book ? '当前小说的视频任务已提交。' : '批量视频任务已提交。');
    } catch (error) { message.error(error?.message || '提交视频任务失败'); } finally { setActionBusy(''); }
  }
  async function runMerge() {
    if (!batch?.id || actionBusy) return;
    setActionBusy('merge');
    try {
      await submitBatchMerge(batch.id, { requestId: requestID('bf11-merge'), timingMode: 'speed', speed: 1, ttsSpeed: 1.7 });
      await loadRuntimeStatus({ quiet: true });
      message.success('批量合并任务已提交。');
    } catch (error) { message.error(error?.message || '提交批量合并失败'); } finally { setActionBusy(''); }
  }
  async function saveSettings(patch) {
    try {
      await saveBatchSettings(batch.id, { patch, expectedRevision: Number(batch?.settingsState?.revision || 0) });
      await refreshBatch();
      message.success('引擎配置已保存到当前批量作品。');
      return true;
    } catch (error) { message.error(error?.message || '保存引擎配置失败'); return false; }
  }
  async function previewChangeImpact(patch) {
    try { const impact = await getChangeImpact(batch.id, { patch, expectedRevision: Number(batch?.settingsState?.revision || 0) }); return { ok: true, impact: resultData(impact, 'impact') }; } catch (error) { return { ok: false, message: error?.message || '无法读取配置影响' }; }
  }
  const batchMenuItems = [
    { key: 'production', label: '批量生成视频', disabled: !productionCapability.available, title: productionCapability.reason },
    { key: 'merge', label: '合并当前主 VIDEO', disabled: !mergeCapability.available, title: mergeCapability.reason }
  ];
  const uploadMenuItems = [{ key: 'selected', label: `提交选中（${selectedBookIds.length}）`, disabled: !selectedBookIds.length }, { key: 'all', label: '提交全部' }];

  return <section className="shuihuo-workbench batch-factory-workbench">
    <header className="shuihuo-workbench-header">
      <div className="shuihuo-workbench-heading"><button className="shuihuo-back-link" type="button" title="返回个人作品" aria-label="返回个人作品" onClick={onBack}><ArrowLeftOutlined /></button><strong>批量工厂 · {batch?.title || '未命名批量'}</strong><div className="shuihuo-workbench-progress" aria-label={`原文就绪 ${progress}%`}><div className="shuihuo-workbench-progress-track"><i style={{ width: `${progress}%` }} /></div><span>{progress}%</span></div></div>
      <div className="shuihuo-workbench-toolbar" role="toolbar" aria-label="批量工厂工具栏">
        <Button type="text" icon={<BarsOutlined />} onClick={() => setNovelListOpen(true)}>小说列表</Button>
        <Button type="text" icon={<SettingOutlined />} onClick={() => setEngineOpen(true)}>引擎配置</Button>
        <Tooltip title={runCapability.available ? '配置并生成资产、画面和视频提示词' : '可先配置并保存提示词；执行生成前需要可用的文本模型。'}><Button type="text" icon={<FileTextOutlined />} onClick={() => setAiOpen(true)}>AI 推理</Button></Tooltip>
        <Dropdown menu={{ items: batchMenuItems, onClick: ({ key }) => key === 'production' ? runProduction() : runMerge() }}><Button className="shuihuo-batch-button" type="text" icon={<PictureOutlined />} loading={actionBusy === 'production' || actionBusy === 'merge'}>批量操作</Button></Dropdown>
        <Tooltip title="V11 当前生产服务没有取消接口；不会把尚未停止的供应商任务误标记为已取消。"><Button className="shuihuo-cancel-button" type="text" disabled>取消操作</Button></Tooltip>
      </div>
      <div className="shuihuo-workbench-export"><Button type="text" icon={<BarsOutlined />} onClick={() => { setLogsOpen(true); loadRuntimeStatus(); }} loading={logsLoading}>任务/日志</Button><Dropdown menu={{ items: uploadMenuItems, onClick: ({ key }) => setUploadMode(key) }}><Button icon={<UploadOutlined />}>上传网络</Button></Dropdown></div>
      <div className="shuihuo-project-stats"><span><b>{books.length}</b> 本小说</span><span><b>{readyBooks}</b> 原文就绪</span><span><b>{totalVideos}</b> VIDEO</span></div>
    </header>
    <div className="shuihuo-workbench-table batch-factory-workbench-table" role="table" aria-label="批量工厂小说生产表">
      <div className="shuihuo-workbench-head" role="row">{['序号', '小说正文', '预设', '提示词', '片段库', '操作'].map(item => <div role="columnheader" key={item}>{item}</div>)}</div>
      {books.map((book, index) => {
        const state = batchFactoryBookState(book);
        const rangeLines = contentRangeLinesForBook(book);
        const previewText = batchFactoryPreviewText(book.sourceText, book);
        const videos = book.videos || [];
        return <article className="shuihuo-workbench-row batch-factory-book-row" key={book.id} role="row">
          <div className="shuihuo-workbench-cell shuihuo-order-cell"><strong>{index + 1}</strong></div>
          <div className="shuihuo-workbench-cell batch-factory-book-content"><strong>{book.title || `小说 ${index + 1}`}</strong><span>bookId：{book.bookId || '—'} · 书城：{bookPlatformName(book, platformNames)} · 展示前 {rangeLines} 行</span><p>{previewText || '原文尚未获取。创建前须按保存的书城与 bookId 抓取原文。'}</p><Button type="link" size="small" onClick={() => openContentEditor(book)} disabled={!String(book.sourceText || '').trim()}>编辑生产内容</Button></div>
          <div className="shuihuo-workbench-cell shuihuo-preset-cell batch-factory-book-preset-cell"><div className="shuihuo-tag-list">{[...(book.assets?.characters || []), ...(book.assets?.scenes || []), ...(book.assets?.props || [])].slice(0, 6).map(asset => <Tag key={asset.id || assetName(asset)}>{assetName(asset)}</Tag>)}</div><button className="shuihuo-preset-picker" type="button" onClick={() => setAssetBook(book)}>添加角色</button><button className="shuihuo-preset-picker" type="button" onClick={() => setAssetBook(book)}>添加场景</button><button className="shuihuo-preset-picker" type="button" onClick={() => setAssetBook(book)}>添加道具</button></div>
		  <div className="shuihuo-workbench-cell shuihuo-prompt-cell batch-factory-book-prompt-cell"><div><b>画面提示词</b><button className="shuihuo-prompt-box" type="button" onClick={() => setPromptBook(book)}><span>{videos[0]?.visualPrompt || '当前没有画面提示词；生成画面图前可在弹窗中填写。'}</span><FullscreenOutlined /></button></div><div><b>视频提示词</b><button className="shuihuo-prompt-box" type="button" onClick={() => setPromptBook(book)}><span>{videos[0]?.videoPrompt || (videos.length ? `${videos.length} 个 VIDEO 的最终提示词可在弹窗中逐个读取。` : 'AI 推理完成后生成视频提示词。')}</span><FullscreenOutlined /></button></div></div>
		  <div className="shuihuo-workbench-cell shuihuo-library-cell batch-factory-book-library-cell"><Tooltip title="打开当前小说的分镜主版本与候选版本。"><button className="shuihuo-primary-media" type="button" onClick={() => setMediaBook(book)}><CloudUploadOutlined /><span>管理主版本</span></button></Tooltip><div className="shuihuo-media-grid" aria-label="当前小说的片段候选库">{Array.from({ length: 4 }).map((_, itemIndex) => <Tooltip key={`asset-slot-${itemIndex}`} title="打开当前小说的分镜候选版本。"><button className="shuihuo-media-tile is-empty" type="button" onClick={() => setMediaBook(book)} aria-label={`打开当前小说的候选槽 ${itemIndex + 1}`}><PictureOutlined /></button></Tooltip>)}</div>{videos.length ? <Button type="text" size="small" onClick={() => setMediaBook(book)}>管理 {videos.length} 个 VIDEO</Button> : <span className="batch-factory-library-note">AI 推理后显示该书的分镜 / VIDEO</span>}</div>
          <div className="shuihuo-workbench-cell batch-factory-actions"><Tag color={state.tone}>{state.label}</Tag><span>{state.detail}</span><Button type="link" size="small" onClick={() => setViewingBook(book)}>查看资料</Button></div>
        </article>;
      })}
      {!books.length ? <div className="shuihuo-workbench-empty">当前批量还没有小说。返回个人作品后，从“批量工厂”新建书单。</div> : null}
    </div>

    <Modal title={`小说列表 · ${books.length} 本`} open={novelListOpen} onCancel={() => setNovelListOpen(false)} footer={null} width="min(1480px, calc(100vw - 48px))" className="batch-factory-novel-modal"><NovelMetadata books={books} createdAt={batch?.createdAt} selectedBookIds={selectedBookIds} onSelectionChange={setSelectedBookIds} onViewBook={setViewingBook} platformNames={platformNames} /></Modal>
    <Modal title={viewingBook?.title || '小说详情'} open={Boolean(viewingBook)} onCancel={() => setViewingBook(null)} footer={null} width={720} className="batch-factory-book-detail-modal"><Descriptions bordered size="small" column={1}>{viewingBook ? <><Descriptions.Item label="Book ID">{viewingBook.bookId || '—'}</Descriptions.Item><Descriptions.Item label="书城">{bookPlatformName(viewingBook, platformNames)}</Descriptions.Item><Descriptions.Item label="风格">{value(viewingBook.sourceMetadata, 'style')}</Descriptions.Item><Descriptions.Item label="男女频">{value(viewingBook.sourceMetadata, 'gender')}</Descriptions.Item><Descriptions.Item label="标签">{value(viewingBook.sourceMetadata, 'tags')}</Descriptions.Item><Descriptions.Item label="推荐理由">{value(viewingBook.sourceMetadata, 'reason')}</Descriptions.Item><Descriptions.Item label="评级">{value(viewingBook.sourceMetadata, 'rating')}</Descriptions.Item><Descriptions.Item label="来源">{value(viewingBook.sourceMetadata, 'sourceMode') === 'manual_original' ? '手动书单' : '小说获取'}</Descriptions.Item><Descriptions.Item label="正文保存">{String(viewingBook.sourceText || '').length} 字</Descriptions.Item><Descriptions.Item label="原文状态">{batchFactoryBookState(viewingBook).detail}</Descriptions.Item></> : null}</Descriptions></Modal>
    <Modal title={editingContentBook ? `编辑生产内容 · ${editingContentBook.title}` : '编辑生产内容'} open={Boolean(editingContentBook)} onCancel={() => setEditingContentBook(null)} onOk={saveWorkingContent} confirmLoading={contentSaving} okText="保存生产内容" width={820} destroyOnClose><Space direction="vertical" size={14} style={{ width: '100%' }}><Alert type="info" showIcon message="只编辑当前小说用于 AI 推理的视频生产内容" description="原文会继续完整保存；未开启“改文后上传”时，121 仍上传本次内容截取保存的原文。" /><Input.TextArea rows={16} value={editingContentValue} onChange={event => setEditingContentValue(event.target.value)} placeholder="输入当前小说的生产内容" /><Tooltip title={workingFrontCapability.available ? '基于当前输入生成候选；生成不会覆盖工作文本' : workingFrontCapability.reason}><Button onClick={createViralCandidate} loading={rewritingFront} disabled={!workingFrontCapability.available || !String(editingContentValue || '').trim()}>生成爆款候选</Button></Tooltip>{viralCandidate ? <Alert type="warning" showIcon message="爆款候选尚未替换" description={<Space direction="vertical" size={8} style={{ width: '100%' }}><pre className="batch-factory-viral-candidate">{viralCandidate}</pre><Button type="primary" onClick={() => setEditingContentValue(viralCandidate)}>替换为当前生产内容</Button></Space>} /> : null}</Space></Modal>
    <Modal title={assetBook ? `人物场景预设 · ${assetBook.title}` : '人物场景预设'} open={Boolean(assetBook)} onCancel={() => setAssetBook(null)} footer={null} width="min(1440px, calc(100vw - 48px))" className="batch-factory-assets-modal">{assetBook ? <AssetEditor book={assetBook} batchId={batch?.id} onSaved={refreshBatch} onGenerate={() => runAi(assetBook)} canGenerate={runCapability.available} generateReason={runCapability.reason} generating={actionBusy === 'director'} engineSettings={batch?.settingsState?.patch} /> : null}</Modal>
	<Modal title={promptBook ? `提示词 · ${promptBook.title}` : '提示词'} open={Boolean(promptBook)} onCancel={() => setPromptBook(null)} footer={null} width={900}>{promptBook ? <PromptPanel book={promptBook} batchId={batch?.id} onSaved={refreshBatch} /> : null}</Modal>
	<Modal title={mediaBook ? `片段库 · ${mediaBook.title}` : '片段库'} open={Boolean(mediaBook)} onCancel={() => setMediaBook(null)} footer={null} width={900}>{mediaBook ? <MediaVersionPanel book={mediaBook} batchId={batch?.id} versionsByVideo={mediaVersionsByVideo} onSaved={async () => { await refreshBatch(); await loadRuntimeStatus({ quiet: true }); }} /> : null}</Modal>
    <BatchFactoryAiReasoningModal open={aiOpen} batch={batch} books={books} onClose={() => setAiOpen(false)} onSaved={refreshBatch} onRun={() => runAi('all')} running={actionBusy === 'director'} runAvailable={runCapability.available} runReason={runCapability.reason} />
    <Modal title="任务 / 日志" open={logsOpen} onCancel={() => setLogsOpen(false)} footer={<Button onClick={() => loadRuntimeStatus()}>刷新状态</Button>} width={860}><BatchLogs productionStatus={productionStatus} mergeStatus={mergeStatus} error={logsError} /></Modal>
    <UploadNetwork batch={batch} books={books} selectedBookIds={selectedBookIds} capabilities={capabilities} productionStatus={productionStatus} mergeStatus={mergeStatus} mode={uploadMode} onClose={() => setUploadMode('')} />
    <BatchFactoryEngineSettingsDrawer open={engineOpen} batch={batch} onClose={() => setEngineOpen(false)} onSave={saveSettings} />
  </section>;
}
