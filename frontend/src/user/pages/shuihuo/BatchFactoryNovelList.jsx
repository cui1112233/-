import {
  ArrowLeftOutlined,
  BarsOutlined,
  CloudUploadOutlined,
  FileTextOutlined,
  FullscreenOutlined,
	LeftOutlined,
  PictureOutlined,
	RightOutlined,
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
  createBookAsset,
  createPublishIntent,
	  cancelBatchProduction,
  getCapabilities,
  listBookAssets,
  listBookAssetImages,
  getConfigVersions,
  getFinalPrompt,
  getDraft,
  getMergeStatus,
  getProductionStatus,
  getPublishCredential,
  getChangeImpact,
  rewriteWorkingFront,
  runBatchDirector,
  runBookStage,
  retryBookStage,
  saveBatchSettings,
  updateBookAsset,
  uploadBookAssetImage,
  setPrimaryBookAssetImage,
  saveDraft,
	  saveVideoOverride,
  submitBatchMerge,
  submitBatchProduction
} from '../../../shared/api/batchFactoryV11';
import { BatchFactoryEngineSettingsDrawer } from './BatchFactoryEngineSettingsDrawer';
import { BatchFactoryAiReasoningModal } from './BatchFactoryAiReasoningModal';
import { BatchFactoryBookSettingsModal } from './BatchFactoryBookSettingsModal';
import { batchFactoryBookState, batchFactoryNovelTableRow } from './batchFactoryBookState';
import { batchFactoryPreviewText, contentRangeLinesForBook, publishContentWithWorkingFront } from './batchFactoryContentRange';
import { getWorkshopPlatforms } from '../../../shared/api/novelFetchWorkshop';
import { batchFactoryPlatformOptions } from './batchFactoryPlatformOptions';
import { BOOK_CONFIG_REGIONS, bookAssetSummary, bookConfigRegionStatus } from './batchFactoryBookConfigRegions';

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

function NovelMetadata({ books, createdAt, selectedBookIds, onSelectionChange, onViewBook, platformNames, productionStatus, mergeStatus }) {
  const selected = new Set(selectedBookIds);
  const allSelected = books.length > 0 && books.every(book => selected.has(book.id));
  return <div className="batch-factory-novel-list batch-factory-novel-fetch-list" role="table" aria-label="小说列表">
    <div className="batch-factory-novel-list-head" role="row"><span>推送日期</span><span><Checkbox checked={allSelected} onChange={event => onSelectionChange(event.target.checked ? books.map(book => book.id) : [])} aria-label="全选小说" /></span><span>ID</span><span>书名</span><span>书城</span><span>风格</span><span>男女频</span><span>标签</span><span>推荐理由</span><span>评级</span><span>AI判断</span><span>原文</span><span>AI文案</span><span>网站提交</span><span>状态</span><span>操作</span></div>
    {books.map((book, index) => {
      const row = batchFactoryNovelTableRow(book, index, createdAt, { productionStatus, mergeStatus });
      const metadata = book.sourceMetadata || {};
      return <div className="batch-factory-novel-list-row" key={book.id} role="row">
        <span>{row.createdAt}</span><span><Checkbox checked={selected.has(book.id)} onChange={event => onSelectionChange(event.target.checked ? [...selected, book.id] : [...selected].filter(id => id !== book.id))} aria-label={`选择 ${row.title}`} /></span><span className="batch-factory-book-id">{row.bookId}</span><strong title={row.title}>{row.title}</strong><span>{bookPlatformName(book, platformNames)}</span><span>{value(metadata, 'style')}</span><span>{value(metadata, 'gender')}</span><span>{value(metadata, 'tags')}</span><span>{value(metadata, 'reason')}</span><span>{value(metadata, 'rating')}</span><span>{metadata.classifyStatus || '—'}</span><span className={row.original === '✓' ? 'is-ready' : ''}>{row.original}</span><span>{row.ai1}</span><span>{row.websiteSubmit}</span><span className={row.status === '处理中' ? 'is-scheduled' : ''} title={row.state?.detail}>{row.status}{row.state?.manual ? ' · 已手调' : ''}</span><span><Button size="small" onClick={() => onViewBook(book)}>查看</Button></span>
      </div>;
    })}
  </div>;
}

function readImageAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

function AssetImageVersions({ asset, batchId, bookId, onChanged }) {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const loadImages = async ({ quiet = false } = {}) => {
    if (!batchId || !bookId || !asset?.id) return;
    setLoading(true);
    try {
      const response = await listBookAssetImages(batchId, bookId, asset.id);
      const next = resultData(response, 'images');
      setImages(Array.isArray(next) ? next : []);
    } catch (error) {
      if (!quiet) message.error(error?.message || '读取资产图片版本失败');
    } finally { setLoading(false); }
  };
  useEffect(() => { loadImages({ quiet: true }); }, [batchId, bookId, asset?.id]);
  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      message.error('仅支持 PNG、JPG、WEBP 图片。');
      return;
    }
    setSaving('upload');
    try {
      await uploadBookAssetImage(batchId, bookId, asset.id, await readImageAsDataURL(file));
      await loadImages({ quiet: true });
      await onChanged?.();
      message.success('图片版本已保存到当前小说资产。');
    } catch (error) { message.error(error?.message || '上传资产图片失败'); } finally { setSaving(''); }
  }
  async function choosePrimary(image) {
    if (image.isPrimary) return;
    setSaving(image.id);
    try {
      await setPrimaryBookAssetImage(batchId, bookId, asset.id, image.id);
      await loadImages({ quiet: true });
      await onChanged?.();
      message.success('已切换为主图。');
    } catch (error) { message.error(error?.message || '切换主图失败'); } finally { setSaving(''); }
  }
  const primary = images.find(image => image.isPrimary) || null;
  const candidates = images.filter(image => image.id !== primary?.id);
  return <section className="batch-factory-asset-images">
    <div className="batch-factory-asset-images-head"><b>图片版本（{images.length}）</b><Space size={8} wrap><label className="batch-factory-image-upload"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} disabled={saving !== ''} />{saving === 'upload' ? '正在上传…' : '上传图片版本'}</label><Tooltip title="V11 尚未提供该书的资产图片接口用于图片模型生成；只有真实模型服务回执接入后才会开放。"><Button size="small" disabled>AI 生成暂不可用</Button></Tooltip><Button size="small" loading={loading} onClick={() => loadImages()} disabled={saving !== ''}>刷新</Button></Space></div>
    {primary ? <div className="batch-factory-asset-primary"><img src={primary.url} alt={`${asset.name} 主图`} /><span>主图 · 版本 {primary.revision}</span></div> : <p className="shuihuo-modal-note">还没有图片版本。上传后会保存为这个资产的首个主图。</p>}
    {candidates.length ? <div className="batch-factory-asset-candidates">{candidates.map(image => <article key={image.id}><img src={image.url} alt={`${asset.name} 候选图`} /><span>候选版本 {image.revision}</span><Button size="small" loading={saving === image.id} disabled={saving !== '' && saving !== image.id} onClick={() => choosePrimary(image)}>切换为主图</Button></article>)}</div> : null}
  </section>;
}

function AssetEditor({ book, batchId, onSaved, onGenerate, onRegenerate, onRetry, canGenerate, generateReason, generating, engineSettings }) {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [kind, setKind] = useState('character');
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [edits, setEdits] = useState({});
  const [search, setSearch] = useState('');
  const kindOptions = [{ value: 'character', label: 'AI角色' }, { value: 'scene', label: 'AI场景' }, { value: 'prop', label: 'AI道具' }];
  const loadAssets = async ({ quiet = false } = {}) => {
    if (!batchId || !book?.id) return;
    setLoading(true);
    try {
      const response = await listBookAssets(batchId, book.id);
      const next = resultData(response, 'assets');
      setAssets(Array.isArray(next) ? next : []);
    } catch (error) {
      if (!quiet) message.error(error?.message || '读取当前小说资产失败');
    } finally { setLoading(false); }
  };
  useEffect(() => {
    setAssets(Array.isArray(book?.assetRecords) ? book.assetRecords : []);
    setEdits({});
    setSearch('');
    loadAssets({ quiet: true });
  }, [batchId, book?.id]);
  const visibleAssets = assets.filter(asset => asset.kind === kind).filter(asset => {
    const query = search.trim().toLowerCase();
    return !query || `${asset.name} ${asset.prompt}`.toLowerCase().includes(query);
  });
  async function addAsset() {
    setSavingId('new');
    try {
      const response = await createBookAsset(batchId, book.id, { kind, name: newName, prompt: newPrompt });
      setAssets(current => [...current, resultData(response, 'asset')]);
      setNewName(''); setNewPrompt('');
      message.success('资产已保存到当前小说。');
      await onSaved?.();
    } catch (error) { message.error(error?.message || '新增资产失败'); } finally { setSavingId(''); }
  }
  async function saveAsset(asset) {
    const edit = edits[asset.id] || asset;
    setSavingId(asset.id);
    try {
      const response = await updateBookAsset(batchId, book.id, asset.id, { name: edit.name, prompt: edit.prompt, expectedRevision: Number(asset.revision || 0) });
      const updated = resultData(response, 'asset');
      setAssets(current => current.map(item => item.id === asset.id ? updated : item));
      setEdits(current => { const next = { ...current }; delete next[asset.id]; return next; });
      message.success('资产提示词已保存。');
      await onSaved?.();
    } catch (error) { message.error(error?.message || '保存资产失败'); } finally { setSavingId(''); }
  }
  async function runPreset() {
    try {
      await onGenerate?.();
      await loadAssets({ quiet: true });
    } catch (_) { /* runAi already reports its business error */ }
  }
  return <section className="batch-factory-preset-shell">
    <Alert type="info" showIcon message="当前小说的人物、场景与道具" description="每一项都归属当前小说并持久化保存。智能预设成功后会写入导演提取的资产；手动修改会保留为该书的人工资产。" />
    <div className="shuihuo-preset-toolbar batch-factory-preset-toolbar">
      <Tooltip title="当前批量或当前书的有效引擎配置"><Select disabled value={engineSettings?.textModelId || undefined} placeholder="未设置文本模型" options={engineSettings?.textModelId ? [{ value: engineSettings.textModelId, label: engineSettings.textModelId }] : []} /></Tooltip>
      <Tooltip title={canGenerate ? '仅在当前书没有文案时提取人物、场景、道具；已有手动资产不会被覆盖。' : generateReason}><Button type="primary" loading={generating} disabled={!canGenerate || generating} onClick={runPreset}>智能预设</Button></Tooltip>
      <Tooltip title="基于当前书内容重新生成 AI 文案和自动资产；手动编辑的资产提示词保留。"><Button loading={generating} disabled={!canGenerate || generating} onClick={onRegenerate}>重新生成资产</Button></Tooltip>
      <Tooltip title="只重跑当前小说最后失败的阶段。"><Button disabled={!canGenerate || generating} onClick={onRetry}>重试资产</Button></Tooltip>
      <Button loading={loading} onClick={() => loadAssets()}>刷新资产</Button>
      <Tooltip title="每个资产在下方独立维护上传后的图片版本；图片模型生成尚未接入。"><Button disabled>图片模型生成未接入</Button></Tooltip>
    </div>
    <div className="shuihuo-preset-layout batch-factory-preset-layout">
      <aside className="shuihuo-preset-list">
        <div className="shuihuo-preset-list-head"><strong>资产列表 ({visibleAssets.length})</strong><Select size="small" value={kind} onChange={setKind} options={kindOptions} /><Input.Search value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索名称或提示词" allowClear /></div>
        <div className="shuihuo-prompt-list">
          {visibleAssets.map(asset => {
            const edit = edits[asset.id] || asset;
            return <article className="shuihuo-prompt-row" key={asset.id}><div className="shuihuo-prompt-row-head"><Tag>{kindOptions.find(option => option.value === asset.kind)?.label}</Tag><Tag color={asset.source === 'manual' ? 'cyan' : 'blue'}>{asset.source === 'manual' ? '手动' : '导演提取'}</Tag></div><Input value={edit.name} onChange={event => setEdits(current => ({ ...current, [asset.id]: { ...edit, name: event.target.value } }))} placeholder="资产名称" /><Input.TextArea rows={4} value={edit.prompt} onChange={event => setEdits(current => ({ ...current, [asset.id]: { ...edit, prompt: event.target.value } }))} placeholder="输入可用于画面与视频编译的资产提示词" /><Button size="small" type="primary" loading={savingId === asset.id} disabled={savingId !== '' && savingId !== asset.id} onClick={() => saveAsset(asset)}>保存该资产</Button><AssetImageVersions asset={asset} batchId={batchId} bookId={book.id} onChanged={onSaved} /></article>;
          })}
          {!loading && !visibleAssets.length ? <div className="shuihuo-prompt-empty"><b>＋</b><p>当前分类还没有资产。可手动添加，或点击“智能预设”从当前小说提取。</p></div> : null}
        </div>
      </aside>
      <main className="shuihuo-preset-library">
        <h3>新增{kindOptions.find(option => option.value === kind)?.label}</h3>
        <Space direction="vertical" size={12} style={{ width: '100%' }}><Input value={newName} onChange={event => setNewName(event.target.value)} placeholder="名称" /><Input.TextArea rows={7} value={newPrompt} onChange={event => setNewPrompt(event.target.value)} placeholder="提示词：描述这个人物、场景或道具的可见特征" /><Button type="primary" loading={savingId === 'new'} disabled={savingId !== '' || !newName.trim() || !newPrompt.trim()} onClick={addAsset}>保存到当前小说</Button></Space>
        <p className="shuihuo-modal-note">这里保存的是当前小说的生产资产，批量中其他小说不会读取或覆盖它。图片上传后的版本也归属当前资产；图片模型生成仍需真实服务回执，不会把文字伪装成图片。</p>
      </main>
    </div>
  </section>;
}

function storyboardVideoLabel(video, index) {
	return `${video?.label || `分镜${String(index + 1).padStart(2, '0')}`} → VIDEO${String(index + 1).padStart(2, '0')}`;
}
function StoryboardVideoNavigator({ videos, selectedVideoId, onSelect }) {
	const index = Math.max(0, videos.findIndex(video => video.id === selectedVideoId));
	const hasVideos = videos.length > 0;
	return <Space wrap className="batch-factory-storyboard-navigator"><Tooltip title="上一分镜"><Button aria-label="上一分镜" icon={<LeftOutlined />} disabled={!hasVideos || index === 0} onClick={() => onSelect(videos[index - 1]?.id)} /></Tooltip><Select value={selectedVideoId || undefined} onChange={onSelect} style={{ minWidth: 260 }} placeholder="选择分镜 / VIDEO" options={videos.map((video, videoIndex) => ({ value: video.id, label: storyboardVideoLabel(video, videoIndex) }))} /><Tooltip title="下一分镜"><Button aria-label="下一分镜" icon={<RightOutlined />} disabled={!hasVideos || index >= videos.length - 1} onClick={() => onSelect(videos[index + 1]?.id)} /></Tooltip></Space>;
}

function PromptPanel({ book, batchId, onSaved, onRegenerate, onRetry, regenerating }) {
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
	  return <Space direction="vertical" size={12} style={{ width: '100%' }}><Space wrap><StoryboardVideoNavigator videos={videos} selectedVideoId={selectedVideoId} onSelect={setSelectedVideoId} /><Button onClick={loadPrompt} loading={loading} disabled={!selectedVideoId}>读取最终视频提示词</Button></Space><label className="shuihuo-form-label">视频提示词<Input.TextArea rows={5} value={videoPrompt} onChange={event => setVideoPrompt(event.target.value)} placeholder="这段文字会进入 VIDEO 的最终编译" /></label><label className="shuihuo-form-label">画面提示词<Input.TextArea rows={5} value={visualPrompt} onChange={event => setVisualPrompt(event.target.value)} placeholder="仅用于生成当前 VIDEO 的画面图片，不会进入视频提示词" /></label><Space wrap><Button type="primary" loading={saving} disabled={!selectedVideo} onClick={savePrompts}>保存当前 VIDEO 提示词</Button><Tooltip title="按当前小说原文重新执行 AI 文案；已手动保存的 VIDEO 提示词会保留。"><Button loading={regenerating} disabled={regenerating} onClick={onRegenerate}>重新生成文案</Button></Tooltip><Button disabled={regenerating} onClick={onRetry}>重试文案</Button></Space>{prompt ? <pre className="batch-factory-final-prompt">{prompt?.compiledPrompt || prompt?.compiled || prompt?.content || JSON.stringify(prompt, null, 2)}</pre> : <p className="shuihuo-modal-note">AI 推理完成后，每个 VIDEO 的最终视频提示词由 V11 编译器实时生成；画面提示词仅服务画面图。</p>}</Space>;
}

function MediaVersionPanel({ book, batchId, versionsByVideo, onSaved, onRegenerate, onRetry, regenerating }) {
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
	return <Space direction="vertical" size={14} style={{ width: '100%' }}><Alert type="info" showIcon message="当前分镜的主版本与候选版本" description="主版本是下一次合并唯一读取的 VIDEO；候选仅用于回退。重新生成成功后会出现新的版本。" /><Space wrap><StoryboardVideoNavigator videos={videos} selectedVideoId={selectedVideoId} onSelect={setSelectedVideoId} /><Tooltip title="为当前 VIDEO 创建新的候选视频版本，不改变当前主版本。"><Button loading={regenerating} disabled={!selectedVideo || regenerating} onClick={() => onRegenerate?.(selectedVideo?.id)}>重新生成视频</Button></Tooltip><Button disabled={!selectedVideo || regenerating} onClick={() => onRetry?.(selectedVideo?.id)}>重试视频</Button></Space>{primary ? <section className="batch-factory-media-primary"><b>主版本</b><span>{primary.id} · {primary.updatedAt || primary.createdAt || '已完成'}</span><a href={primary.mediaUrl} target="_blank" rel="noreferrer">打开视频</a></section> : <p className="shuihuo-modal-note">当前 VIDEO 还没有真实成功的视频版本。</p>}<div className="batch-factory-media-candidates">{Array.from({ length: 4 }).map((_, index) => { const version = candidates[index]; return version ? <article key={version.id}><b>候选 {index + 1}</b><span>{version.id}</span><a href={version.mediaUrl} target="_blank" rel="noreferrer">打开视频</a><Button size="small" loading={savingTaskId === version.id} onClick={() => choosePrimary(version)}>切换为主版本</Button></article> : <article className="is-empty" key={`empty-${index}`}><PictureOutlined /><span>候选槽 {index + 1}</span></article>; })}</div></Space>;
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
  const [configTarget, setConfigTarget] = useState(null);
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
	const [activeProductionRequestID, setActiveProductionRequestID] = useState('');
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
	const cancelCapability = capability(capabilities, 'production.cancel');
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
      setConfigVersions(resultData(nextVersions, 'configVersions') || []);
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
  useEffect(() => {
    if (!configTarget?.book) return;
    const refreshed = books.find(book => book.id === configTarget.book.id);
    if (refreshed && refreshed !== configTarget.book) setConfigTarget(current => current ? { ...current, book: refreshed } : current);
  }, [batch?.id, configTarget?.book?.id]);

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
  async function runBookStageAction(book, stage, mode = 'missing', videoId = '') {
    if (!batch?.id || !book?.id || actionBusy) return;
    setActionBusy(`stage-${stage}`);
    try {
      await runBookStage(batch.id, book.id, stage, { mode, videoId, requestId: requestID(`bf11-${stage}-${mode}`) });
      await Promise.all([refreshBatch(), loadRuntimeStatus({ quiet: true })]);
      const labels = { director: mode === 'force' ? '已重新生成文案' : '已生成文案', image: mode === 'force' ? '已重新生成图片' : '已生成图片', video: mode === 'force' ? '已创建新的视频候选版本' : '已提交视频生成' };
      message.success(labels[stage] || '当前小说阶段已提交。');
    } catch (error) { message.error(error?.message || '当前小说阶段执行失败'); } finally { setActionBusy(''); }
  }
  async function retryLastFailedStage(book, videoId = '') {
    if (!batch?.id || !book?.id || actionBusy) return;
    setActionBusy('stage-retry');
    try {
      await retryBookStage(batch.id, book.id, { videoId, requestId: requestID('bf11-book-retry') });
      await Promise.all([refreshBatch(), loadRuntimeStatus({ quiet: true })]);
      message.success('已识别并重跑该书最后失败的步骤。');
    } catch (error) { message.error(error?.message || '当前小说没有可重试的失败步骤'); } finally { setActionBusy(''); }
  }
  async function runAi(scope) {
    if (!batch?.id || actionBusy) return;
    if (scope?.id) { await runBookStageAction(scope, 'director'); return; }
    setActionBusy('director');
    try {
      await runBatchDirector(batch.id);
      await refreshBatch();
      message.success('批量 AI 推理已提交并回读当前作品。');
      setAiOpen(false);
    } catch (error) { message.error(error?.message || 'AI 推理失败'); } finally { setActionBusy(''); }
  }
  async function runProduction(book = null) {
    if (!batch?.id || actionBusy) return;
    setActionBusy('production');
    try {
      const operationRequestID = requestID(book ? 'bf11-book-production' : 'bf11-batch-production');
      const provider = batch?.settingsState?.patch?.videoProvider || 'personal_api';
      if (book) await runBookStage(batch.id, book.id, 'video', { mode: 'missing', requestId: operationRequestID });
      else await submitBatchProduction(batch.id, operationRequestID, provider);
      setActiveProductionRequestID(operationRequestID);
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
	async function cancelProduction() {
		if (!batch?.id || actionBusy || !cancelCapability.available) return;
		if (!activeProductionRequestID) {
			message.info('请在本次页面中先发起一个批量视频操作；取消只会作用于该次操作。');
			return;
		}
		setActionBusy('cancel');
		try {
			const result = await cancelBatchProduction(batch.id, activeProductionRequestID);
			await loadRuntimeStatus({ quiet: true });
			const cancelled = resultData(result, 'cancelledTaskIds') || [];
			const skipped = resultData(result, 'skipped') || [];
			if (cancelled.length) message.success(`已取消 ${cancelled.length} 个本地执行器任务。`);
			else if (skipped.length) message.warning(`没有可取消的本地任务：${skipped.map(item => item.reason).filter(Boolean).join('；')}`);
			else message.info('当前没有运行中的视频任务。');
		} catch (error) { message.error(error?.message || '取消视频任务失败'); } finally { setActionBusy(''); }
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
		<Tooltip title={cancelCapability.available ? '取消可取消的本地执行器任务；其它供应商保持在途状态。' : cancelCapability.reason}><Button className="shuihuo-cancel-button" type="text" loading={actionBusy === 'cancel'} disabled={!cancelCapability.available || Boolean(actionBusy)} onClick={cancelProduction}>取消操作</Button></Tooltip>
      </div>
      <div className="shuihuo-workbench-export"><Button type="text" icon={<BarsOutlined />} onClick={() => { setLogsOpen(true); loadRuntimeStatus(); }} loading={logsLoading}>任务/日志</Button><Dropdown menu={{ items: uploadMenuItems, onClick: ({ key }) => setUploadMode(key) }}><Button icon={<UploadOutlined />}>上传网络</Button></Dropdown></div>
      <div className="shuihuo-project-stats"><span><b>{books.length}</b> 本小说</span><span><b>{readyBooks}</b> 原文就绪</span><span><b>{totalVideos}</b> VIDEO</span></div>
    </header>
    <div className="shuihuo-workbench-table batch-factory-workbench-table" role="table" aria-label="批量工厂小说生产表">
      <div className="shuihuo-workbench-head" role="row">{['序号', '小说正文', '单书配置', '预设', '提示词', '片段库', '操作'].map(item => <div role="columnheader" key={item}>{item}</div>)}</div>
      {books.map((book, index) => {
        const state = batchFactoryBookState(book, { productionStatus, mergeStatus });
        const rangeLines = contentRangeLinesForBook(book);
        const previewText = batchFactoryPreviewText(book.sourceText, book);
        const videos = book.videos || [];
        return <article className="shuihuo-workbench-row batch-factory-book-row" key={book.id} role="row">
          <div className="shuihuo-workbench-cell shuihuo-order-cell"><strong>{index + 1}</strong></div>
          <div className="shuihuo-workbench-cell batch-factory-book-content"><strong>{book.title || `小说 ${index + 1}`}</strong><span>bookId：{book.bookId || '—'} · 书城：{bookPlatformName(book, platformNames)} · 展示前 {rangeLines} 行</span><p>{previewText || '原文尚未获取。创建前须按保存的书城与 bookId 抓取原文。'}</p><Button type="link" size="small" onClick={() => openContentEditor(book)} disabled={!String(book.sourceText || '').trim()}>编辑生产内容</Button></div>
          <div className="shuihuo-workbench-cell batch-factory-book-config-cell"><div className="batch-factory-book-config-regions">{BOOK_CONFIG_REGIONS.map(region => { const status = bookConfigRegionStatus(book, region.key); const detail = region.key === 'assets' ? bookAssetSummary(book) : status.label; return <button type="button" key={region.key} className={`batch-factory-book-config-region is-${status.tone}`} onClick={() => setConfigTarget({ book, region: region.key })}><b>{region.label}</b><small>{detail}</small></button>; })}</div></div>
          <div className="shuihuo-workbench-cell shuihuo-preset-cell batch-factory-book-preset-cell"><div className="shuihuo-tag-list">{[...(book.assets?.characters || []), ...(book.assets?.scenes || []), ...(book.assets?.props || [])].slice(0, 6).map(asset => <Tag key={asset.id || assetName(asset)}>{assetName(asset)}</Tag>)}</div><button className="shuihuo-preset-picker" type="button" onClick={() => setAssetBook(book)}>添加角色</button><button className="shuihuo-preset-picker" type="button" onClick={() => setAssetBook(book)}>添加场景</button><button className="shuihuo-preset-picker" type="button" onClick={() => setAssetBook(book)}>添加道具</button></div>
		  <div className="shuihuo-workbench-cell shuihuo-prompt-cell batch-factory-book-prompt-cell"><div className="batch-factory-storyboard-video-map" aria-label="分镜与 VIDEO 一对一对应">{videos.map((video, videoIndex) => <Tag key={video.id || `${book.id}-video-${videoIndex}`}>{`分镜${String(videoIndex + 1).padStart(2, '0')} → VIDEO${String(videoIndex + 1).padStart(2, '0')}`}</Tag>)}{!videos.length ? <span>AI 推理后生成 1:1 分镜 / VIDEO</span> : null}</div><div><b>画面提示词</b><button className="shuihuo-prompt-box" type="button" onClick={() => setPromptBook(book)}><span>{videos[0]?.visualPrompt || '当前没有画面提示词；生成画面图前可在弹窗中填写。'}</span><FullscreenOutlined /></button></div><div><b>视频提示词</b><button className="shuihuo-prompt-box" type="button" onClick={() => setPromptBook(book)}><span>{videos[0]?.videoPrompt || (videos.length ? `${videos.length} 个 VIDEO 的最终提示词可在弹窗中逐个读取。` : 'AI 推理完成后生成视频提示词。')}</span><FullscreenOutlined /></button></div></div>
		  <div className="shuihuo-workbench-cell shuihuo-library-cell batch-factory-book-library-cell"><Tooltip title="打开当前小说的分镜主版本与候选版本。"><button className="shuihuo-primary-media" type="button" onClick={() => setMediaBook(book)}><CloudUploadOutlined /><span>管理主版本</span></button></Tooltip><div className="shuihuo-media-grid" aria-label="当前小说的片段候选库">{Array.from({ length: 4 }).map((_, itemIndex) => <Tooltip key={`asset-slot-${itemIndex}`} title="打开当前小说的分镜候选版本。"><button className="shuihuo-media-tile is-empty" type="button" onClick={() => setMediaBook(book)} aria-label={`打开当前小说的候选槽 ${itemIndex + 1}`}><PictureOutlined /></button></Tooltip>)}</div>{videos.length ? <Button type="text" size="small" onClick={() => setMediaBook(book)}>管理 {videos.length} 个 VIDEO</Button> : <span className="batch-factory-library-note">AI 推理后显示该书的分镜 / VIDEO</span>}</div>
          <div className="shuihuo-workbench-cell batch-factory-actions"><Tag color={state.tone}>{state.label}</Tag>{state.manual ? <Tag color="purple">已手调</Tag> : null}<span>{state.detail}</span><Space size={4} wrap><Button size="small" onClick={() => refreshBatch()} disabled={Boolean(actionBusy)}>刷新</Button><Button size="small" onClick={() => runBookStageAction(book, 'director')} loading={actionBusy === 'stage-director'} disabled={Boolean(actionBusy) && actionBusy !== 'stage-director'}>生成文案</Button><Button size="small" onClick={() => runBookStageAction(book, 'image')} loading={actionBusy === 'stage-image'} disabled={Boolean(actionBusy) && actionBusy !== 'stage-image'}>生成图片</Button><Button size="small" onClick={() => runBookStageAction(book, 'video')} loading={actionBusy === 'stage-video'} disabled={Boolean(actionBusy) && actionBusy !== 'stage-video'}>生成视频</Button><Button size="small" danger onClick={() => retryLastFailedStage(book)} loading={actionBusy === 'stage-retry'} disabled={Boolean(actionBusy) && actionBusy !== 'stage-retry'}>重试</Button></Space><Button type="link" size="small" onClick={() => setViewingBook(book)}>查看资料</Button></div>
        </article>;
      })}
      {!books.length ? <div className="shuihuo-workbench-empty">当前批量还没有小说。返回个人作品后，从“批量工厂”新建书单。</div> : null}
    </div>

    <Modal title={`小说列表 · ${books.length} 本`} open={novelListOpen} onCancel={() => setNovelListOpen(false)} footer={null} width="min(1480px, calc(100vw - 48px))" className="batch-factory-novel-modal"><NovelMetadata books={books} createdAt={batch?.createdAt} selectedBookIds={selectedBookIds} onSelectionChange={setSelectedBookIds} onViewBook={setViewingBook} platformNames={platformNames} productionStatus={productionStatus} mergeStatus={mergeStatus} /></Modal>
    <Modal title={viewingBook?.title || '小说详情'} open={Boolean(viewingBook)} onCancel={() => setViewingBook(null)} footer={null} width={720} className="batch-factory-book-detail-modal"><Descriptions bordered size="small" column={1}>{viewingBook ? <><Descriptions.Item label="Book ID">{viewingBook.bookId || '—'}</Descriptions.Item><Descriptions.Item label="书城">{bookPlatformName(viewingBook, platformNames)}</Descriptions.Item><Descriptions.Item label="风格">{value(viewingBook.sourceMetadata, 'style')}</Descriptions.Item><Descriptions.Item label="男女频">{value(viewingBook.sourceMetadata, 'gender')}</Descriptions.Item><Descriptions.Item label="标签">{value(viewingBook.sourceMetadata, 'tags')}</Descriptions.Item><Descriptions.Item label="推荐理由">{value(viewingBook.sourceMetadata, 'reason')}</Descriptions.Item><Descriptions.Item label="评级">{value(viewingBook.sourceMetadata, 'rating')}</Descriptions.Item><Descriptions.Item label="来源">{value(viewingBook.sourceMetadata, 'sourceMode') === 'manual_original' ? '手动书单' : '小说获取'}</Descriptions.Item><Descriptions.Item label="正文保存">{String(viewingBook.sourceText || '').length} 字</Descriptions.Item><Descriptions.Item label="生产状态">{batchFactoryBookState(viewingBook, { productionStatus, mergeStatus }).label} · {batchFactoryBookState(viewingBook, { productionStatus, mergeStatus }).detail}</Descriptions.Item></> : null}</Descriptions></Modal>
    <Modal title={editingContentBook ? `编辑生产内容 · ${editingContentBook.title}` : '编辑生产内容'} open={Boolean(editingContentBook)} onCancel={() => setEditingContentBook(null)} onOk={saveWorkingContent} confirmLoading={contentSaving} okText="保存生产内容" width={820} destroyOnClose><Space direction="vertical" size={14} style={{ width: '100%' }}><Alert type="info" showIcon message="只编辑当前小说用于 AI 推理的视频生产内容" description="原文会继续完整保存；未开启“改文后上传”时，121 仍上传本次内容截取保存的原文。" /><Input.TextArea rows={16} value={editingContentValue} onChange={event => setEditingContentValue(event.target.value)} placeholder="输入当前小说的生产内容" /><Tooltip title={workingFrontCapability.available ? '基于当前输入生成候选；生成不会覆盖工作文本' : workingFrontCapability.reason}><Button onClick={createViralCandidate} loading={rewritingFront} disabled={!workingFrontCapability.available || !String(editingContentValue || '').trim()}>生成爆款候选</Button></Tooltip>{viralCandidate ? <Alert type="warning" showIcon message="爆款候选尚未替换" description={<Space direction="vertical" size={8} style={{ width: '100%' }}><pre className="batch-factory-viral-candidate">{viralCandidate}</pre><Button type="primary" onClick={() => setEditingContentValue(viralCandidate)}>替换为当前生产内容</Button></Space>} /> : null}</Space></Modal>
    <BatchFactoryBookSettingsModal open={Boolean(configTarget)} batch={batch} book={configTarget?.book} activeRegion={configTarget?.region} onClose={() => setConfigTarget(null)} onSaved={refreshBatch} onOpenBookAssets={book => setAssetBook(book)} />
    <Modal title={assetBook ? `人物场景预设 · ${assetBook.title}` : '人物场景预设'} open={Boolean(assetBook)} onCancel={() => setAssetBook(null)} footer={null} width="min(1440px, calc(100vw - 48px))" className="batch-factory-assets-modal">{assetBook ? <AssetEditor book={assetBook} batchId={batch?.id} onSaved={refreshBatch} onGenerate={() => runAi(assetBook)} onRegenerate={() => runBookStageAction(assetBook, 'director', 'force')} onRetry={() => retryLastFailedStage(assetBook)} canGenerate={runCapability.available} generateReason={runCapability.reason} generating={actionBusy === 'director' || actionBusy === 'stage-director'} engineSettings={batch?.settingsState?.patch} /> : null}</Modal>
	<Modal title={promptBook ? `提示词 · ${promptBook.title}` : '提示词'} open={Boolean(promptBook)} onCancel={() => setPromptBook(null)} footer={null} width={900}>{promptBook ? <PromptPanel book={promptBook} batchId={batch?.id} onSaved={refreshBatch} onRegenerate={() => runBookStageAction(promptBook, 'director', 'force')} onRetry={() => retryLastFailedStage(promptBook)} regenerating={actionBusy === 'stage-director' || actionBusy === 'stage-retry'} /> : null}</Modal>
	<Modal title={mediaBook ? `片段库 · ${mediaBook.title}` : '片段库'} open={Boolean(mediaBook)} onCancel={() => setMediaBook(null)} footer={null} width={900}>{mediaBook ? <MediaVersionPanel book={mediaBook} batchId={batch?.id} versionsByVideo={mediaVersionsByVideo} onSaved={async () => { await refreshBatch(); await loadRuntimeStatus({ quiet: true }); }} onRegenerate={videoId => runBookStageAction(mediaBook, 'video', 'force', videoId)} onRetry={videoId => retryLastFailedStage(mediaBook, videoId)} regenerating={actionBusy === 'stage-video' || actionBusy === 'stage-retry'} /> : null}</Modal>
    <BatchFactoryAiReasoningModal open={aiOpen} batch={batch} books={books} presetVersions={configVersions} onClose={() => setAiOpen(false)} onSaved={refreshBatch} onPresetsChanged={async () => { const next = await getConfigVersions(); setConfigVersions(resultData(next, 'configVersions') || []); }} onRun={() => runAi('all')} running={actionBusy === 'director'} runAvailable={runCapability.available} runReason={runCapability.reason} />
    <Modal title="任务 / 日志" open={logsOpen} onCancel={() => setLogsOpen(false)} footer={<Button onClick={() => loadRuntimeStatus()}>刷新状态</Button>} width={860}><BatchLogs productionStatus={productionStatus} mergeStatus={mergeStatus} error={logsError} /></Modal>
    <UploadNetwork batch={batch} books={books} selectedBookIds={selectedBookIds} capabilities={capabilities} productionStatus={productionStatus} mergeStatus={mergeStatus} mode={uploadMode} onClose={() => setUploadMode('')} />
    <BatchFactoryEngineSettingsDrawer open={engineOpen} batch={batch} onClose={() => setEngineOpen(false)} onSave={saveSettings} />
  </section>;
}
