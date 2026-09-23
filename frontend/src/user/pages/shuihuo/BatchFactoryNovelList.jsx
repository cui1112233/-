import { h3PromptEditRequest } from './h3PromptEditing.js';
import { measureH3VideoLines } from './h3LineAudio.js';
import { smartUnifiedAnalysisForBook, smartUnifiedDisplayEnabled } from './batchFactorySmartUnified.js';
import { publicationMetadataValue } from './batchFactoryPublicationMetadata.js';
import {
  ArrowLeftOutlined,
  BarsOutlined,
  CloudUploadOutlined,
  FileTextOutlined,
  LoadingOutlined,
  ReloadOutlined,
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
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  message
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createBookAsset,
	  cancelBatchProduction,
  fetchBookOriginal,
  getCapabilities,
  getBatch,
  generateBookAssetImages,
  listBookAssets,
  listBookAssetImages,
  getConfigVersions,
  getFinalPrompt,
  getH3Trace,
	measureH3Audio,
	compileH3Video,
  getBookStageSummary,
  getDraft,
  getMergeStatus,
  getProductionStatus,
  getBatchAutomationStatus,
  listAutomationPresets,
  startBatchAutomation,
  pauseBatchAutomation,
  resumeBatchAutomation,
  retryBatchAutomation,
  cancelBatchAutomation,
  getChangeImpact,
  rewriteWorkingFront,
  listSystemPresetCatalog,
  runBatchDirector,
  runBookStage,
  retryBookStage,
  saveBatchSettings,
  saveBookOverride,
  updateBookAsset,
  updateBookMetadata,
  uploadBookAssetImage,
  setPrimaryBookAssetImage,
  saveDraft,
	  saveVideoOverride,
  deleteProductionTask,
  submitBatchMerge,
  submitBookMerge,
  submitBatchProduction,
  submitBookTo121,
  classifyBookPublishMetadata,
  get121OrganizationOptions
} from '../../../shared/api/batchFactoryV11';
import { getConfig } from '../../../shared/api/config';
import { textToSpeech } from '../../../shared/api/tts';
import { BatchFactoryUnifiedSettingsModal } from './BatchFactoryUnifiedSettingsModal';
import { BatchFactoryBookSettingsModal } from './BatchFactoryBookSettingsModal';
import { batchFactoryBatchProgress, batchFactoryBookState, batchFactoryBookTimeline, batchFactoryNovelTableRow, batchFactoryVideoProgress } from './batchFactoryBookState';
import { batchFactoryPreviewText, batchFactoryProductionText, contentRangeLinesForBook } from './batchFactoryContentRange';
import { batchMediaCounts as runtimeBatchMediaCounts, resolveBookProductionText as runtimeResolveBookProductionText } from './batchFactoryRuntimeLogic';
import { getWorkshopPlatforms } from '../../../shared/api/novelFetchWorkshop';
import { ProductionMediaBoundary } from '../batch-factory-v11/ProductionMediaBoundary';
import { checkWebSubmitEnvironment, getWebSubmitConfig, testWebSubmitVisible } from '../../../shared/api/novelFetch';
import { batchFactoryPlatformOptions } from './batchFactoryPlatformOptions';
import { BOOK_CONFIG_REGIONS, bookAssetSummary, bookConfigRegionStatus } from './batchFactoryBookConfigRegions';
import { videoProviderForModel } from './videoProviderBinding';


const DEFAULT_TTS = { voice: 'zh-CN-XiaoxiaoNeural', style: 'general', speed: 1.8, pitch: 10 };
const UNIFIED_BOOK_SETTING_KEYS = [
  'textModelId', 'imageModelId', 'videoModelId', 'videoProvider', 'aspectRatio', 'productionMode',
  'storyboardDurationLimit', 'maxVideoDuration', 'fixedSingleVideo', 'audioPlanningEnabled',
  'audioMergeEnabled', 'audioDurationSeconds', 'audioDurationFingerprint', 'audioDurationManual',
  'tts', 'publishRewriteEnabled', 'publishSettings'
];
function readBatchFactoryAudioDuration(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const clear = () => { audio.removeAttribute('src'); URL.revokeObjectURL(url); };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = Number(audio.duration || 0);
      clear();
      duration > 0 && Number.isFinite(duration) ? resolve(duration) : reject(new Error('无法读取配音真实时长'));
    };
    audio.onerror = () => { clear(); reject(new Error('配音音频无法读取')); };
    audio.src = url;
  });
}
function batchFactoryAudioFingerprint(input, tts = {}) {
  const payload = JSON.stringify([String(input || ''), String(tts.voice || ''), String(tts.style || ''), Number(tts.speed || 0), Number(tts.pitch || 0)]);
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `a1-${(hash >>> 0).toString(16)}-${payload.length}`;
}
function batchFactoryBookAudioInput(book = {}) {
  return batchFactoryProductionText(book?.sourceText || book?.contentPreview, book?.workingFrontContent, book);
}
async function batchFactoryBookTts(settings = {}) {
  const config = await getConfig().catch(() => ({}));
  return { ...DEFAULT_TTS, ...(config?.tts || {}), ...(settings?.tts || {}) };
}
async function generateBatchFactoryBookAudioMeasurement(book, settings = {}) {
  const input = batchFactoryBookAudioInput(book);
  if (!input) throw new Error('当前书没有可用于配音的生产内容');
  const tts = await batchFactoryBookTts(settings);
  const blob = await textToSpeech({ input, ...tts });
  const duration = await readBatchFactoryAudioDuration(blob);
  return {
    durationSeconds: Number(duration.toFixed(2)),
    fingerprint: batchFactoryAudioFingerprint(input, tts),
    tts,
    blob
  };
}
function blobToBase64(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error('无法读取 H3 配音数据'));
		reader.onload = () => resolve(String(reader.result || '').split(',').at(-1) || '');
		reader.readAsDataURL(blob);
	});
}
async function saveBookOverrideWithRetry(batchId, bookId, expectedRevision, input) {
  try {
    return await saveBookOverride(batchId, bookId, { ...input, expectedRevision: Number(expectedRevision || 0) });
  } catch (error) {
    if (Number(error?.status) !== 409) throw error;
    const latest = await getBatch(batchId);
    const latestBatch = latest?.batch || latest;
    const latestBook = (latestBatch?.books || []).find(item => item?.id === bookId);
    if (!latestBook) throw error;
    return saveBookOverride(batchId, bookId, { ...input, expectedRevision: Number(latestBook.revision || 0) });
  }
}
function batchFactoryContentMode(book = {}) {
  const metadata = book?.sourceMetadata || {};
  const stored = String(metadata.productionContentMode || '').trim().toLowerCase();
  if (stored === 'viral' || stored === 'custom' || stored === 'original') return stored;
  const working = String(book?.workingFrontContent || '').trim();
  const source = String(book?.sourceText || '').trim();
  return !working || (source && working === source) ? 'original' : 'custom';
}
function batchFactoryContentModeLabel(book = {}) {
  const mode = batchFactoryContentMode(book);
  return mode === 'viral' ? '爆款' : mode === 'custom' ? '自创' : '原文';
}
function batchFactoryWorkbenchConfigRegions(book) {
  const base = BOOK_CONFIG_REGIONS.filter(region => !['video', 'visual'].includes(region.key));
  const video = bookConfigRegionStatus(book, 'video');
  const visual = bookConfigRegionStatus(book, 'visual');
  const labels = [...new Set([video?.label, visual?.label].filter(Boolean))];
  const tone = video?.tone === visual?.tone ? (video?.tone || 'muted') : (video?.tone || visual?.tone || 'muted');
  return [...base, { key: 'media', label: '画面与视频', combinedStatus: { tone, label: labels.join(' / ') || '已配置' } }];
}

function value(metadata, key) { return String(metadata?.[key] || '').trim() || '—'; }
function bookPlatformName(book, platformNames = {}) {
  const metadata = book?.sourceMetadata || {};
  return String(metadata.platformName || metadata.platformLabel || platformNames[String(book?.platform || '')] || '').trim() || '未命名书城';
}
function resultData(result, key) { return result?.[key] || result || {}; }
function sameSettingsPatch(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}
function h3DirectorCards(book) {
  const output = book?.directorRevision?.output || {};
  const document = output.h3_director || output.h3Director || {};
  return Array.isArray(document.director_cards) ? document.director_cards : Array.isArray(document.directorCards) ? document.directorCards : [];
}
function requestID(prefix) { return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`; }
function stageActionKey(stage, bookId) { return `stage-${stage}:${String(bookId || '')}`; }
function capability(caps, key) { return caps?.[key] || { available: false, reason: '正在读取 V12 服务能力' }; }
function assetName(asset) { return String(asset?.name || asset?.label || asset?.id || '未命名预设'); }
function assetPrompt(asset) { return String(asset?.prompt || asset?.visualPrompt || asset?.description || ''); }
function savedDraftKey(type, asset) { return `asset:${type}:${asset?.id || assetName(asset)}`; }
function effectiveBookSettings(batch, book) {
  const batchPatch = batch?.settingsState?.patch || {};
  const bookPatch = book?.settingsState?.patch || {};
  return { ...batchPatch, ...bookPatch, publishSettings: { ...(batchPatch.publishSettings || {}), ...(bookPatch.publishSettings || {}) } };
}
function effectiveBookAssetRules(batch, book) {
  return {
    ...(batch?.settingsState?.patch?.aiPromptConfig?.assets || {}),
    ...(book?.settingsState?.patch?.aiPromptConfig?.assets || {})
  };
}
function selectedPublishProfile(settings = {}) {
  const wanted = String(settings.websiteProfileId || '').trim();
  return (Array.isArray(settings.websiteProfiles) ? settings.websiteProfiles : [])
    .find(profile => String(profile?.id || '').trim() === wanted) || {};
}
function decompressionCountForUpload(batch, book) {
  const settings = effectiveBookSettings(batch, book).publishSettings || {};
  const profile = selectedPublishProfile(settings);
  const candidate = settings?.advanced?.jieyaNum ?? profile?.advanced?.jieyaNum;
  const numeric = Number(candidate);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 4;
}
function isBookUploadedTo121(book) {
  return String(book?.sourceMetadata?.websiteSubmitStatus || '').trim().toLowerCase() === 'uploaded';
}
function uploadProgressForBook(book) {
  const value = book?.sourceMetadata?.websiteSubmitProgress;
  return value && typeof value === 'object' ? value : null;
}
function sourcePlatformIdForUpload(book = {}) {
  const metadata = book?.sourceMetadata || {};
  const candidates = [book?.platform, metadata.platformId, metadata.platform_id, metadata.platformName, metadata.platformLabel];
  const labels = { '黑岩付费': '1', '番茄付费': '2', '七猫付费': '3', '点众付费': '4', '阅文付费': '6', '番茄免费': '7', '知乎付费': '15', '掌阅付费': '20', '卓越付费': '26', '九州书城': '29', '掌文付费': '31' };
  return candidates.map(value => String(value || '').trim()).find(value => /^(1|2|3|4|6|7|15|20|26|29|31)$/.test(value))
    || candidates.map(value => labels[String(value || '').trim()]).find(Boolean)
    || '';
}
function completePublishMapping(_settings = {}, book = {}) {
  // 121 platform derives from the source book. Gender/style/tags are per-book
  // classification data and the server fills missing values immediately before
  // submit; a batch profile may only supply presentation/advanced options.
  return Boolean(sourcePlatformIdForUpload(book));
}
function classificationLabel(metadata = {}) {
  const status = String(metadata?.classifyStatus || '').trim();
  if (status === 'classified') return '已识别';
  if (status === 'manual') return '已手调';
  if (status === 'failed') return '识别失败';
  return '待识别';
}
const BATCH_FACTORY_TABLE_COLUMNS = [
  { label: '序号', minWidth: 56 },
  { label: '小说正文', minWidth: 300 },
  { label: '单书配置', minWidth: 176 },
  { label: '分镜资产', minWidth: 145 },
  { label: '分镜提示词', minWidth: 330 },
  { label: '分镜视频', minWidth: 300 },
  { label: '操作', minWidth: 220 }
];
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

function storyboardVideoLabel(video, index) {
  const ordinal = Number(index) + 1;
  const label = String(video?.label || video?.title || '').trim();
  return label ? `分镜 ${ordinal} · ${label}` : `分镜 ${ordinal}`;
}

function bookMergeJobs(status, bookId) {
  return (status?.jobs || []).filter(job => job?.bookId === bookId).sort((left, right) => String(left?.updatedAt || left?.createdAt || '').localeCompare(String(right?.updatedAt || right?.createdAt || '')));
}

function mergeJobSpeed(job) {
  const speed = Number(job?.speed || 0);
  return speed > 0 ? speed : 1;
}

function defaultBookMerge(jobs) {
  const completed = jobs.filter(job => job?.status === 'succeeded' && String(job?.outputUrl || '').trim());
  return [...completed].reverse().find(job => Math.abs(mergeJobSpeed(job) - 1) < 0.001) || completed.at(-1) || null;
}

function latestBookMerge(status, bookId) {
  const jobs = bookMergeJobs(status, bookId);
  return [...jobs].reverse().find(job => job?.status === 'running' || job?.status === 'queued') || defaultBookMerge(jobs) || jobs.at(-1) || null;
}

function bookVideoReady(book, productionStatus) {
  const videoIds = (book?.videos || []).map(video => String(video?.id || '')).filter(Boolean);
  if (!videoIds.length) return false;
  const completed = new Set((productionStatus?.jobs || [])
    .filter(job => job?.bookId === book?.id)
    .flatMap(job => job?.tasks || [])
    .filter(task => task?.status === 'succeeded' && String(task?.mediaUrl || '').trim())
    .map(task => String(task?.videoId || '')));
  return videoIds.every(videoId => completed.has(videoId));
}

function NovelMetadata({ books, createdAt, selectedBookIds, onSelectionChange, onViewBook, platformNames, productionStatus, mergeStatus, stageSummaries }) {
  const selected = new Set(selectedBookIds);
  const allSelected = books.length > 0 && books.every(book => selected.has(book.id));
  return <div className="batch-factory-novel-list batch-factory-novel-fetch-list batch-factory-novel-list-v13" role="table" aria-label="小说列表">
    <div className="batch-factory-novel-list-head" role="row">
      <span className="is-order"><Checkbox checked={allSelected} indeterminate={!allSelected && selected.size > 0} onChange={event => onSelectionChange(event.target.checked ? books.map(book => book.id) : [])} aria-label="全选小说" /><b>序号</b></span>
      <span>小说</span><span>内容</span><span>风格</span><span>男女频</span><span>状态</span><span>操作</span>
    </div>
    {books.map((book, index) => {
      const row = batchFactoryNovelTableRow(book, index, createdAt, { productionStatus, mergeStatus, stageSummary: stageSummaries?.[book.id] });
      const metadata = book.sourceMetadata || {};
      const mode = batchFactoryContentMode(book);
      return <div className="batch-factory-novel-list-row" key={book.id} role="row">
        <span className="is-order"><Checkbox checked={selected.has(book.id)} onChange={event => onSelectionChange(event.target.checked ? [...selected, book.id] : [...selected].filter(id => id !== book.id))} aria-label={`选择 ${row.title}`} /><b>{String(index + 1).padStart(2, '0')}</b></span>
        <span className="is-book"><strong title={row.title}>{row.title}</strong><small>ID {row.bookId} · {bookPlatformName(book, platformNames)}</small></span>
        <span><i className={`batch-factory-content-mode is-${mode}`}>{batchFactoryContentModeLabel(book)}</i></span>
        <span>{publicationMetadataValue(metadata, 'style')}</span>
        <span>{publicationMetadataValue(metadata, 'gender')}</span>
        <span className={row.status === '处理中' ? 'is-scheduled' : ''} title={row.state?.detail}>{row.status}{row.state?.manual ? ' · 已手调' : ''}</span>
        <span><Button size="small" onClick={() => onViewBook(book)}>查看</Button></span>
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

function AssetEditor({ book, batchId, onSaved, onGenerate, onRegenerate, onRetry, onAssetPromptChange, assetRules, canGenerate, generateReason, generating, engineSettings }) {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [kind, setKind] = useState('character');
  const [libraryKind, setLibraryKind] = useState('character');
  const [search, setSearch] = useState('');
  const [assetPromptCatalog, setAssetPromptCatalog] = useState([]);
  const [assetPromptLoading, setAssetPromptLoading] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState([]);
  const [imageGenerating, setImageGenerating] = useState(false);
  const [assetImages, setAssetImages] = useState({});
  const [editing, setEditing] = useState(null);
	const [starredCharacterNames, setStarredCharacterNames] = useState([]);
  const kindOptions = [{ value: 'character', label: '人物' }, { value: 'scene', label: '场景' }, { value: 'prop', label: '道具' }];
  const categoryLabel = value => kindOptions.find(item => item.value === value)?.label || '资产';
  async function loadImages(nextAssets, { quiet = false } = {}) {
    const entries = await Promise.all((nextAssets || []).map(async asset => {
      try { return [asset.id, resultData(await listBookAssetImages(batchId, book.id, asset.id), 'images')]; }
      catch (error) { if (!quiet) message.error(error?.message || '读取资产图片版本失败'); return [asset.id, []]; }
    }));
    setAssetImages(Object.fromEntries(entries.map(([assetId, images]) => [assetId, Array.isArray(images) ? images : []])));
  }
  const loadAssets = async ({ quiet = false } = {}) => {
    if (!batchId || !book?.id) return;
    setLoading(true);
    try {
      const response = await listBookAssets(batchId, book.id);
      const next = resultData(response, 'assets');
      const saved = Array.isArray(next) ? next : [];
      setAssets(saved);
      await loadImages(saved, { quiet: true });
    } catch (error) {
      if (!quiet) message.error(error?.message || '读取当前小说资产失败');
    } finally { setLoading(false); }
  };
  useEffect(() => {
    setAssets(Array.isArray(book?.assetRecords) ? book.assetRecords : []);
    setSearch('');
    setSelectedAssetIds([]);
    loadAssets({ quiet: true });
  }, [batchId, book?.id]);
	useEffect(() => { setStarredCharacterNames(Array.isArray(book?.settingsState?.patch?.starredCharacterNames) ? book.settingsState.patch.starredCharacterNames : []); }, [book?.id, book?.revision, book?.settingsState?.revision]);
  useEffect(() => {
    let active = true;
    setAssetPromptLoading(true);
    listSystemPresetCatalog('script').then(script => {
      if (active) setAssetPromptCatalog(
        (Array.isArray(script?.catalog) ? script.catalog : []).filter(item => item?.slot === 'script.asset-extraction')
      );
    }).catch(error => { if (active) message.error(error?.message || '读取资产提示词失败'); }).finally(() => { if (active) setAssetPromptLoading(false); });
    return () => { active = false; };
  }, [book?.id]);
  const textModelId = String(engineSettings?.textModelId || '').trim();
  const imageModelId = String(engineSettings?.imageModelId || '').trim();
  const aspectRatio = String(engineSettings?.aspectRatio || '9:16');
  const currentAssetPromptId = String(assetRules?.extraction?.presetId || '').trim();
  const assetPromptOptions = (currentAssetPromptId && !assetPromptCatalog.some(item => item.id === currentAssetPromptId)
    ? [{ id: currentAssetPromptId, name: assetRules?.extraction?.presetName || '预设已失效', version: assetRules?.extraction?.presetVersion || 1, disabled: true }, ...assetPromptCatalog]
    : assetPromptCatalog).map(item => ({ value: item.id, label: `${item.name || item.id} · v${item.version || 1}`, disabled: item.disabled === true }));
  const visibleAssets = assets.filter(asset => asset.kind === kind).filter(asset => {
    const query = search.trim().toLowerCase();
    return !query || `${asset.name} ${asset.prompt}`.toLowerCase().includes(query);
  });
  const libraryImages = assets.filter(asset => asset.kind === libraryKind).flatMap(asset => (assetImages[asset.id] || []).map(image => ({ image, asset }))).filter(({ asset }) => {
    const query = search.trim().toLowerCase();
    return !query || `${asset.name} ${asset.prompt}`.toLowerCase().includes(query);
  });
  async function saveAsset({ close = true } = {}) {
    if (!editing?.name?.trim() || !editing?.prompt?.trim()) { message.warning('请填写资产名称和提示词。'); return null; }
    const existing = assets.find(asset => asset.id === editing.id);
    setSavingId(existing?.id || 'new');
    try {
      const result = existing
        ? await updateBookAsset(batchId, book.id, existing.id, { name: editing.name, prompt: editing.prompt, expectedRevision: Number(existing.revision || 0) })
        : await createBookAsset(batchId, book.id, { kind: editing.kind, name: editing.name, prompt: editing.prompt });
      const savedAsset = resultData(result, 'asset');
      if (close) setEditing(null);
      await loadAssets({ quiet: true });
      await onSaved?.();
      message.success('当前小说资产已保存。');
      return savedAsset?.id ? savedAsset : null;
    } catch (error) { message.error(error?.message || '保存资产失败'); return null; } finally { setSavingId(''); }
  }
  async function runPreset() {
    try {
      if (!textModelId) { message.warning('请先选择个人中心已启用的文本模型。'); return; }
      await onGenerate?.(textModelId);
      await loadAssets({ quiet: true });
    } catch (_) { /* runAi already reports its business error */ }
  }
  async function chooseAssetPrompt(presetId) {
    const preset = assetPromptCatalog.find(item => item.id === presetId);
    try {
      await onAssetPromptChange?.(preset ? { presetId: preset.id, presetName: preset.name, presetSlot: preset.slot, presetVersion: preset.version, constraintCategory: preset.constraintCategory || '' } : { presetId: '' });
      message.success(preset?.id === 'batch-assets-h3' ? 'H3 人物场景道具方案已选中，点击“重新生成资产”应用到当前书。' : '资产提示词已保存。');
    } catch (error) { message.error(error?.message || '保存资产提示词失败'); }
  }
  function toggleAssetSelection(assetId, checked) {
    setSelectedAssetIds(current => checked ? [...new Set([...current, assetId])] : current.filter(id => id !== assetId));
  }
	async function toggleCharacterStar(asset) {
		if (asset?.kind !== 'character') return;
		const name = assetName(asset);
		const starred = starredCharacterNames.includes(name);
		const next = starred ? starredCharacterNames.filter(item => item !== name) : [...new Set([...starredCharacterNames, name])];
		setSavingId(`star-${asset.id}`);
		try {
			await saveBookOverride(batchId, book.id, { patch: { starredCharacterNames: next }, expectedRevision: Number(book?.revision || 0) });
			setStarredCharacterNames(next);
			await onSaved?.();
			message.success(starred ? `已取消“${name}”的星标聚焦。` : `已将“${name}”设为星标聚焦人物。`);
		} catch (error) { message.error(error?.message || '保存星标人物失败'); } finally { setSavingId(''); }
	}
  async function generateImages(assetIds = selectedAssetIds) {
    if (!assetIds.length) { message.warning('请先选择要生成图片的资产。'); return false; }
    if (!imageModelId) { message.warning('请先在引擎配置选择图片模型。'); return false; }
    setImageGenerating(true);
    try {
      const result = await generateBookAssetImages(batchId, book.id, {
        assetIds,
        modelId: imageModelId,
        aspectRatio: aspectRatio || '9:16'
      });
      await loadAssets({ quiet: true });
      await onSaved?.();
      message.success(`已保存 ${resultData(result, 'images')?.length || assetIds.length} 个当前书资产图片版本。`);
      return true;
    } catch (error) { message.error(error?.message || '图片生成失败'); return false; } finally { setImageGenerating(false); }
  }
  async function generateEditedAssetImage() {
    const savedAsset = await saveAsset({ close: false });
    if (!savedAsset) return;
    if (await generateImages([savedAsset.id])) setEditing(null);
  }
  async function uploadImage(asset, event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { message.error('仅支持 PNG、JPG、WEBP 图片。'); return; }
    setSavingId(`upload-${asset.id}`);
    try {
      await uploadBookAssetImage(batchId, book.id, asset.id, await readImageAsDataURL(file));
      await loadImages(assets, { quiet: true });
      await onSaved?.();
      message.success('图片版本已保存到当前小说资产。');
    } catch (error) { message.error(error?.message || '上传资产图片失败'); } finally { setSavingId(''); }
  }
  async function makePrimary(asset, image) {
    if (image.isPrimary) return;
    setSavingId(`primary-${image.id}`);
    try {
      await setPrimaryBookAssetImage(batchId, book.id, asset.id, image.id);
      await loadImages(assets, { quiet: true });
      await onSaved?.();
      message.success('已切换为当前资产主图。');
    } catch (error) { message.error(error?.message || '切换主图失败'); } finally { setSavingId(''); }
  }
  return <section className="batch-factory-preset-shell">
    <Alert type="info" showIcon message="当前小说的人物、场景与道具" description="每一项都归属当前小说并持久化保存。智能预设成功后会写入导演提取的资产；手动修改会保留为该书的人工资产。" />
    <div className="shuihuo-preset-toolbar batch-factory-preset-toolbar">
      <Tooltip title="选择当前书的人物、场景与道具提取提示词；模型统一在引擎配置设置。"><Select value={currentAssetPromptId || undefined} loading={assetPromptLoading} placeholder="选择资产提示词" style={{ minWidth: 230 }} options={assetPromptOptions} onChange={chooseAssetPrompt} /></Tooltip>
      <Tooltip title={canGenerate ? '仅在当前书没有文案时提取人物、场景、道具；已有手动资产不会被覆盖。' : generateReason}><Button type="primary" loading={generating} disabled={!canGenerate || generating} onClick={runPreset}>智能预设</Button></Tooltip>
      <Tooltip title="基于当前书内容重新生成 AI 文案和自动资产；手动编辑的资产提示词保留。"><Button loading={generating} disabled={!canGenerate || generating || !textModelId} onClick={() => onRegenerate?.(textModelId)}>重新生成资产</Button></Tooltip>
      <Tooltip title="只重跑当前小说最后失败的阶段。"><Button disabled={!canGenerate || generating || !textModelId} onClick={() => onRetry?.(textModelId)}>重试资产</Button></Tooltip>
      <Button loading={loading} onClick={() => loadAssets()}>刷新资产</Button>
      <Tooltip title="使用引擎配置中的图片模型和画幅，为选中的当前书资产生成新版本；不会覆盖已有主图。"><Button type="primary" loading={imageGenerating} disabled={imageGenerating || !selectedAssetIds.length || !imageModelId} onClick={() => generateImages()}>AI生成（已选 {selectedAssetIds.length}）</Button></Tooltip>
      <Button onClick={() => setEditing({ kind, name: '', prompt: '' })}>手动添加</Button>
    </div>
    {!imageModelId ? <Alert type="warning" showIcon message="尚未配置图片模型" description="请在该书的引擎配置中选择图片模型后再生成资产图片。" /> : null}
    <div className="shuihuo-preset-layout batch-factory-preset-layout">
      <aside className="shuihuo-preset-list">
        <div className="shuihuo-preset-list-head"><strong>资产列表 ({visibleAssets.length})</strong><Select size="small" value={kind} onChange={setKind} options={kindOptions} /><Input.Search value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索名称或提示词" allowClear /></div>
        <div className="shuihuo-prompt-list">
          {visibleAssets.map(asset => <article className={`shuihuo-prompt-row${selectedAssetIds.includes(asset.id) ? ' is-selected' : ''}${asset.kind === 'character' && starredCharacterNames.includes(assetName(asset)) ? ' is-starred' : ''}`} key={asset.id}><div className="shuihuo-prompt-row-head"><Checkbox checked={selectedAssetIds.includes(asset.id)} onChange={event => toggleAssetSelection(asset.id, event.target.checked)}>生成</Checkbox><Tag>{categoryLabel(asset.kind)}</Tag><strong>{assetName(asset)}</strong>{asset.kind === 'character' ? <Tooltip title={starredCharacterNames.includes(assetName(asset)) ? '取消星标人物聚焦' : '设为星标人物聚焦'}><Button type="text" size="small" className="batch-factory-character-star" loading={savingId === `star-${asset.id}`} onClick={() => toggleCharacterStar(asset)} aria-label={`${assetName(asset)} 星标人物聚焦`}>★</Button></Tooltip> : null}<Button type="text" size="small" onClick={() => setEditing({ ...asset })}>编辑</Button></div><p>{assetPrompt(asset) || '尚未填写可视化提示词'}</p></article>)}
          {!loading && !visibleAssets.length ? <div className="shuihuo-prompt-empty"><b>＋</b><p>暂无提示词，请点击“智能预设”或手动添加。</p><Button onClick={() => setEditing({ kind, name: '', prompt: '' })}>添加提示词</Button></div> : null}
        </div>
      </aside>
      <main className="shuihuo-preset-library">
        <div className="shuihuo-asset-tabs">{kindOptions.map(option => <button type="button" className={libraryKind === option.value ? 'active' : ''} onClick={() => setLibraryKind(option.value)} key={option.value}>{option.label}</button>)}</div>
        <Input.Search value={search} onChange={event => setSearch(event.target.value)} placeholder={`搜索${categoryLabel(libraryKind)}图片...`} className="shuihuo-preset-search" allowClear />
        <div className="shuihuo-image-library-grid">{libraryImages.map(({ image, asset }) => <article className="shuihuo-image-card" key={image.id}><div className="shuihuo-image-card-visual"><img src={image.url} alt={`${assetName(asset)} 图片版本`} /></div><div className="shuihuo-image-card-title"><strong>{assetName(asset)}</strong><Tag>{image.isPrimary ? '主图' : `版本 ${image.revision || ''}`}</Tag></div><p>{assetPrompt(asset) || '生成时未保存提示词快照'}</p><div className="shuihuo-image-card-actions">{!image.isPrimary ? <Button type="text" size="small" loading={savingId === `primary-${image.id}`} onClick={() => makePrimary(asset, image)}>设主图</Button> : <span>当前主图</span>}<label className="batch-factory-image-upload"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => uploadImage(asset, event)} disabled={savingId !== ''} />上传版本</label></div></article>)}{!libraryImages.length ? <div className="shuihuo-image-empty"><b>图片库</b><p>暂无已生成图片</p><span>在左侧勾选人物、场景或道具后，点击顶部“AI生成”。</span></div> : null}</div>
      </main>
    </div>
    <Modal title={editing?.id ? `编辑资产 · ${assetName(editing)}` : `添加${categoryLabel(editing?.kind || kind)}`} open={Boolean(editing)} onCancel={() => setEditing(null)} footer={<Space><Button onClick={() => setEditing(null)}>取消</Button><Button loading={savingId !== ''} onClick={saveAsset}>保存</Button><Tooltip title={imageModelId ? '先保存当前提示词，再按引擎配置为这个资产生成新的图片版本。' : '请先在引擎配置选择图片模型。'}><Button type="primary" loading={imageGenerating} disabled={Boolean(savingId) || imageGenerating || !imageModelId} onClick={generateEditedAssetImage}>生成图片</Button></Tooltip></Space>} width={760} destroyOnClose><Space direction="vertical" size={14} style={{ width: '100%' }}><label className="shuihuo-form-label">资产分类<Select value={editing?.kind} options={kindOptions} onChange={value => setEditing(current => ({ ...current, kind: value }))} /></label><label className="shuihuo-form-label">名称<Input value={editing?.name || ''} onChange={event => setEditing(current => ({ ...current, name: event.target.value }))} /></label><label className="shuihuo-form-label">外观描述 / AI 生图提示词<Input.TextArea rows={9} value={editing?.prompt || ''} onChange={event => setEditing(current => ({ ...current, prompt: event.target.value }))} placeholder="输入人物、场景或道具的可视化提示词" /></label></Space></Modal>
  </section>;
}

function storyboardAssetDefaults(book, videoId) {
  const videos = book?.videos || [];
  const ordinal = videos.findIndex(video => video.id === videoId);
  const draft = book?.directorRevision?.output?.storyboard?.[ordinal] || {};
  const wanted = new Set([...(draft.characters || []), ...(draft.scene ? [draft.scene] : []), ...(draft.props || [])].map(value => String(value || '').trim()).filter(Boolean));
  return (book?.assetRecords || []).filter(asset => wanted.has(String(asset?.name || '').trim())).map(asset => String(asset.id || '')).filter(Boolean);
}

function readStoryboardAssetSelection(book, video) {
  const defaults = storyboardAssetDefaults(book, video?.id);
  const raw = video?.settingsState?.patch?.assetSelection;
  const autoAssetIds = Array.isArray(raw?.autoAssetIds) ? raw.autoAssetIds.map(String).filter(Boolean) : defaults;
  const addedAssetIds = Array.isArray(raw?.addedAssetIds) ? raw.addedAssetIds.map(String).filter(Boolean) : [];
  const excludedAssetIds = Array.isArray(raw?.excludedAssetIds) ? raw.excludedAssetIds.map(String).filter(Boolean) : [];
  const excluded = new Set(excludedAssetIds);
  return { autoAssetIds: [...new Set(autoAssetIds)], addedAssetIds: [...new Set(addedAssetIds)], excludedAssetIds: [...new Set(excludedAssetIds)], candidateIds: [...new Set([...autoAssetIds, ...addedAssetIds, ...excludedAssetIds])], selectedIds: new Set([...autoAssetIds, ...addedAssetIds].filter(id => !excluded.has(id))) };
}

function InlineStoryboardAssets({ book, batchId, selectedVideoId: controlledSelectedVideoId = '', onSelectedVideoChange, onManage, onSaved }) {
  const videos = book?.videos || [];
  const [localSelectedVideoId, setLocalSelectedVideoId] = useState(videos[0]?.id || '');
  const [savingAssetId, setSavingAssetId] = useState('');
  const [starredCharacterNames, setStarredCharacterNames] = useState([]);
  const clickTimers = useRef(new Map());
  const selectedVideoId = controlledSelectedVideoId || localSelectedVideoId;
  const selectVideo = nextId => {
    const value = String(nextId || '');
    setLocalSelectedVideoId(value);
    onSelectedVideoChange?.(value);
  };
  useEffect(() => { setStarredCharacterNames(Array.isArray(book?.settingsState?.patch?.starredCharacterNames) ? book.settingsState.patch.starredCharacterNames : []); }, [book?.id, book?.revision, book?.settingsState?.revision]);
  useEffect(() => () => { for (const timer of clickTimers.current.values()) clearTimeout(timer); clickTimers.current.clear(); }, []);
  useEffect(() => {
    const next = videos.some(video => video.id === selectedVideoId) ? selectedVideoId : (videos[0]?.id || '');
    if (next !== selectedVideoId) selectVideo(next);
  }, [book?.id, videos.map(video => video.id).join('|')]);
  const selectedVideo = videos.find(video => video.id === selectedVideoId) || videos[0];
  const selection = readStoryboardAssetSelection(book, selectedVideo);
  const assets = (book?.assetRecords || []).filter(asset => selection.candidateIds.includes(String(asset.id || '')));
  const currentIndex = Math.max(0, videos.findIndex(video => video.id === selectedVideo?.id));
  const switchVideo = offset => selectVideo(videos[(currentIndex + offset + videos.length) % videos.length]?.id || '');
  const assetGroups = [
    ['character', '人物'],
    ['scene', '场景'],
    ['prop', '道具']
  ].map(([kind, label]) => ({ kind, label, items: assets.filter(asset => asset.kind === kind) }));

  async function saveStar(asset, starred) {
    if (asset?.kind !== 'character') return false;
    const name = assetName(asset);
    const next = starred ? [...new Set([...starredCharacterNames, name])] : starredCharacterNames.filter(item => item !== name);
    try {
      await saveBookOverride(batchId, book.id, { patch: { starredCharacterNames: next }, expectedRevision: Number(book?.revision || 0) });
      setStarredCharacterNames(next);
      await onSaved?.();
      return true;
    } catch (error) { message.error(error?.message || '保存星标人物失败'); return false; }
  }

  async function toggleAsset(asset, { clearStar = false } = {}) {
    if (!selectedVideo || savingAssetId) return;
    const assetId = String(asset.id || '');
    if (!assetId) return;
    const isSelected = selection.selectedIds.has(assetId);
    const autoAssetIds = selection.autoAssetIds;
    const addedAssetIds = isSelected ? selection.addedAssetIds.filter(id => id !== assetId) : [...new Set([...selection.addedAssetIds, ...(autoAssetIds.includes(assetId) ? [] : [assetId])])];
    const excludedAssetIds = isSelected ? [...new Set([...selection.excludedAssetIds, assetId])] : selection.excludedAssetIds.filter(id => id !== assetId);
    setSavingAssetId(assetId);
    try {
      if (clearStar && !(await saveStar(asset, false))) return;
      await saveVideoOverride(batchId, book.id, selectedVideo.id, { patch: { assetSelection: { autoAssetIds, addedAssetIds, excludedAssetIds } }, expectedRevision: Number(selectedVideo.revision || 0) });
      await onSaved?.();
      message.success(isSelected ? `已停用“${assetName(asset)}”，不会进入当前分镜的画面和视频生成。` : `已启用“${assetName(asset)}”。`);
    } catch (error) { message.error(error?.message || '保存分镜资产选择失败'); } finally { setSavingAssetId(''); }
  }

  function onAssetClick(asset) {
    const assetId = String(asset?.id || '');
    if (!assetId) return;
    if (asset.kind === 'character' && starredCharacterNames.includes(assetName(asset))) {
      toggleAsset(asset, { clearStar: true });
      return;
    }
    clickTimers.current.set(assetId, setTimeout(() => { clickTimers.current.delete(assetId); toggleAsset(asset); }, 220));
  }

  async function onAssetDoubleClick(asset) {
    const assetId = String(asset?.id || '');
    const timer = clickTimers.current.get(assetId);
    if (timer) { clearTimeout(timer); clickTimers.current.delete(assetId); }
    if (asset.kind !== 'character') return;
    setSavingAssetId(assetId);
    try {
      const starred = !starredCharacterNames.includes(assetName(asset));
      if (await saveStar(asset, starred)) message.success(starred ? `“${assetName(asset)}”已设为星标聚焦人物。` : `已取消“${assetName(asset)}”的星标聚焦。`);
    } finally { setSavingAssetId(''); }
  }

  if (!selectedVideo) return <div className="batch-factory-cell-shell batch-factory-inline-assets is-empty"><div className="batch-factory-cell-empty">AI 推理后会在这里显示当前书的分镜资产。</div></div>;

  const selectedCount = assets.filter(asset => selection.selectedIds.has(String(asset.id))).length;
  return <div className="batch-factory-cell-shell batch-factory-inline-assets">
    <header className="batch-factory-cell-head">
      <div><b>{storyboardVideoLabel(selectedVideo, currentIndex)}</b><small>{selectedCount}/{assets.length || 0} 已启用</small></div>
      <span className="batch-factory-cell-state">{assets.length ? '资产就绪' : '待提取'}</span>
    </header>
    <div className="batch-factory-cell-content batch-factory-asset-content">
      {assets.length ? assetGroups.map(group => group.items.length ? <section className="batch-factory-asset-group-inline" key={group.kind}>
        <div className="batch-factory-asset-group-label"><b>{group.label}</b><span>{group.items.length}</span></div>
        <div className="batch-factory-storyboard-asset-cards">{group.items.map(asset => {
          const selected = selection.selectedIds.has(String(asset.id));
          const starred = selected && asset.kind === 'character' && starredCharacterNames.includes(assetName(asset));
          return <button type="button" key={asset.id} disabled={savingAssetId === asset.id} onClick={() => onAssetClick(asset)} onDoubleClick={() => onAssetDoubleClick(asset)} className={`batch-factory-storyboard-asset-card ${starred ? 'is-starred' : selected ? 'is-selected' : 'is-muted'}`} title={starred ? '星标人物聚焦；点击后取消星标并停用，双击可取消星标。' : selected ? '点击停用；双击人物卡设为星标聚焦。' : '点击启用：用于当前分镜的图片和视频生成'}>
            <span>{group.label}</span><b>{assetName(asset)}</b>{starred ? <i aria-label="星标人物">★</i> : null}
          </button>;
        })}</div>
      </section> : null) : <div className="batch-factory-cell-empty">当前分镜尚未识别到需要调用的资产。</div>}
      <div className="batch-factory-asset-summary">
        <span>{assetGroups[0].items.length} 人物</span><span>{assetGroups[1].items.length} 场景</span><span>{assetGroups[2].items.length} 道具</span>
        <button type="button" onClick={() => onManage?.(selectedVideo.id)}>管理全部资产</button>
      </div>
    </div>
    <div className="batch-factory-cell-pager">
      <button type="button" aria-label="上一分镜资产" disabled={currentIndex === 0} onClick={() => switchVideo(-1)}><LeftOutlined /></button>
      <span>{currentIndex + 1} / {videos.length}</span>
      <button type="button" aria-label="下一分镜资产" disabled={currentIndex >= videos.length - 1} onClick={() => switchVideo(1)}><RightOutlined /></button>
    </div>
  </div>;
}

function useCompiledVideoPrompt(batchId, book, video, settingsRevision = 0) {
  const [displayPrompt, setDisplayPrompt] = useState('');
  const [compiledPrompt, setCompiledPrompt] = useState('');
  const [baseSetupPrompt, setBaseSetupPrompt] = useState('');
  const [smartUnifiedPending, setSmartUnifiedPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const bookRevision = Number(book?.revision || 0);
  const videoRevision = Number(video?.revision || 0);
  useEffect(() => {
    let active = true;
    if (!batchId || !book?.id || !video?.id) {
      setDisplayPrompt('');
      setCompiledPrompt('');
      setBaseSetupPrompt('');
      setSmartUnifiedPending(false);
      setLoading(false);
      return () => { active = false; };
    }
    setDisplayPrompt('');
    setCompiledPrompt('');
    setBaseSetupPrompt('');
    setSmartUnifiedPending(false);
    setLoading(true);
    getFinalPrompt(batchId, book.id, video.id, { silent: true, suppressGlobalError: true }).then(response => {
      if (!active) return;
	  setDisplayPrompt(String(response?.finalPrompt?.displayPrompt || ''));
	  setCompiledPrompt(String(response?.finalPrompt?.compiledPrompt || ''));
      setBaseSetupPrompt(String(response?.finalPrompt?.baseSetupPrompt || ''));
      setSmartUnifiedPending(response?.finalPrompt?.smartUnifiedPending === true);
    }).catch(() => {
      // The raw director output remains readable when the compiler capability
      // is temporarily unavailable. API errors are intentionally quiet here:
      // this read runs once for every visible book row.
      if (active) { setDisplayPrompt(''); setCompiledPrompt(''); setBaseSetupPrompt(''); }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [batchId, book?.id, bookRevision, video?.id, videoRevision, settingsRevision]);
  return { displayPrompt, compiledPrompt, baseSetupPrompt, smartUnifiedPending, loading };
}

function InlineBookPrompts({ batch, book, batchId, settingsRevision, selectedVideoId: controlledSelectedVideoId = '', onSelectedVideoChange, onManage }) {
  const videos = book?.videos || [];
	const h3Cards = h3DirectorCards(book);
	const smartUnifiedAnalysis = smartUnifiedAnalysisForBook(book);
	const showSmartUnified = smartUnifiedDisplayEnabled(batch, book) && smartUnifiedAnalysis;
  const [localSelectedVideoId, setLocalSelectedVideoId] = useState(videos[0]?.id || '');
	const [h3CardIndex, setH3CardIndex] = useState(0);
  const [promptKind, setPromptKind] = useState('video');
  const selectedVideoId = controlledSelectedVideoId || localSelectedVideoId;
  const selectVideo = nextId => {
    const value = String(nextId || '');
    setLocalSelectedVideoId(value);
    onSelectedVideoChange?.(value);
  };
  const selectedIndex = Math.max(0, videos.findIndex(video => video.id === selectedVideoId));
  const video = videos[selectedIndex] || null;
  const rawVideoPrompt = String(video?.videoPrompt || '');
  const visualPrompt = String(video?.visualPrompt || '');
  const hasVisualPrompt = Boolean(visualPrompt.trim());
  const { displayPrompt, compiledPrompt, smartUnifiedPending, loading } = useCompiledVideoPrompt(batchId, book, video, settingsRevision);
  const videoPrompt = smartUnifiedPending ? '' : (compiledPrompt || displayPrompt || rawVideoPrompt);
  const activePrompt = promptKind === 'visual' ? visualPrompt : videoPrompt;

  useEffect(() => {
    const first = book?.videos?.[0]?.id || '';
    if (!controlledSelectedVideoId) setLocalSelectedVideoId(first);
		setH3CardIndex(0);
    setPromptKind('video');
  }, [book?.id]);

  useEffect(() => {
    if (!videos.some(item => item.id === selectedVideoId) && videos[0]?.id) selectVideo(videos[0].id);
  }, [videos.map(item => item.id).join('|')]);

  function move(direction) {
    const next = videos[selectedIndex + direction];
    if (next) selectVideo(next.id);
  }

  if (!video && h3Cards.length) {
		const h3Card = h3Cards[Math.min(h3CardIndex, h3Cards.length - 1)] || {};
		const camera = h3Card.camera || {};
		return <div className="shuihuo-workbench-cell shuihuo-prompt-cell batch-factory-book-prompt-cell">
			<div className="batch-factory-cell-shell batch-factory-prompt-entry-card is-h3-director-card">
				<header className="batch-factory-cell-head"><div><b>H3 导演卡 {h3CardIndex + 1}</b><small>已提取，尚未编译 VIDEO</small></div></header>
				<div className="batch-factory-cell-content batch-factory-prompt-entry-content">
					<span className="batch-factory-prompt-status">H3 导演卡已提取</span>
					<p>{String(h3Card.source_text || '')}{h3Card.action ? `\n\n动作：${h3Card.action}` : ''}{camera.shot_size ? `\n机位：${camera.shot_size}${camera.shot_angle ? ` · ${camera.shot_angle}` : ''}` : ''}</p>
					{showSmartUnified ? <small>智能统一：{smartUnifiedAnalysis.prompt}</small> : <small>等待真实配音时长编译最终 VIDEO</small>}
				</div>
				<div className="batch-factory-cell-pager">
					<button type="button" aria-label="上一张 H3 导演卡" disabled={h3CardIndex === 0} onClick={() => setH3CardIndex(index => Math.max(0, index - 1))}><LeftOutlined /></button>
					<span>{h3CardIndex + 1} / {h3Cards.length}</span>
					<button type="button" aria-label="下一张 H3 导演卡" disabled={h3CardIndex >= h3Cards.length - 1} onClick={() => setH3CardIndex(index => Math.min(h3Cards.length - 1, index + 1))}><RightOutlined /></button>
				</div>
			</div>
		</div>;
	}

  if (!video) return <div className="shuihuo-workbench-cell shuihuo-prompt-cell batch-factory-book-prompt-cell"><div className="batch-factory-cell-shell"><div className="batch-factory-cell-empty">AI 推理后会在这里显示当前书的分镜提示词。</div></div></div>;

  const stateLabel = promptKind === 'visual' ? (hasVisualPrompt ? '画面已生成' : '待生成') : smartUnifiedPending ? '待分析' : loading ? '编译中' : videoPrompt.trim() ? '最终已编译' : '待生成';

  return <div className="shuihuo-workbench-cell shuihuo-prompt-cell batch-factory-book-prompt-cell">
    <div className="batch-factory-cell-shell batch-factory-prompt-entry-card">
      <header className="batch-factory-cell-head">
        <div><b>{storyboardVideoLabel(video, selectedIndex)}</b><small>{promptKind === 'visual' ? '画面提示词' : '最终视频提示词'}</small></div>
        <div className="batch-factory-cell-segmented" aria-label="提示词类型">
          <button type="button" className={promptKind === 'video' ? 'is-active' : ''} onClick={() => setPromptKind('video')}>视频</button>
          <button type="button" className={promptKind === 'visual' ? 'is-active' : ''} disabled={!hasVisualPrompt} onClick={() => setPromptKind('visual')}>画面</button>
        </div>
      </header>
      <button type="button" className="batch-factory-cell-content batch-factory-prompt-entry-content" aria-label="打开分镜提示词编辑" onClick={() => onManage?.(video.id)}>
        <span className="batch-factory-prompt-status">{stateLabel}</span>
        <p>{activePrompt || (smartUnifiedPending && promptKind === 'video' ? '智能统一已开启，重新生成文案后显示本书分析结果' : loading && promptKind === 'video' ? '正在编译最终视频提示词…' : promptKind === 'visual' ? '请生成画面提示词再查看' : '请生成视频提示词再查看')}</p>
        <small>点击打开完整提示词</small>
      </button>
      <div className="batch-factory-cell-pager">
        <button type="button" aria-label="上一分镜" disabled={selectedIndex === 0} onClick={() => move(-1)}><LeftOutlined /></button>
        <span>{selectedIndex + 1} / {videos.length}</span>
        <button type="button" aria-label="下一分镜" disabled={selectedIndex >= videos.length - 1} onClick={() => move(1)}><RightOutlined /></button>
      </div>
    </div>
  </div>;
}

function StoryboardVideoNavigator({ videos, selectedVideoId, onSelect }) {
	const index = Math.max(0, videos.findIndex(video => video.id === selectedVideoId));
	const hasVideos = videos.length > 0;
	return <Space wrap className="batch-factory-storyboard-navigator"><Tooltip title="上一分镜"><Button aria-label="上一分镜" icon={<LeftOutlined />} disabled={!hasVideos || index === 0} onClick={() => onSelect(videos[index - 1]?.id)} /></Tooltip><Select value={selectedVideoId || undefined} onChange={onSelect} style={{ minWidth: 260 }} placeholder="选择分镜 / VIDEO" options={videos.map((video, videoIndex) => ({ value: video.id, label: storyboardVideoLabel(video, videoIndex) }))} /><Tooltip title="下一分镜"><Button aria-label="下一分镜" icon={<RightOutlined />} disabled={!hasVideos || index >= videos.length - 1} onClick={() => onSelect(videos[index + 1]?.id)} /></Tooltip></Space>;
}

function PromptPanel({ book, batchId, settingsRevision, initialVideoId = '', onSaved, onRegenerate, onRegenerateVisual, onRetry, onGenerateVideo, onViewVideoCandidates, onGenerateVisual, onViewVisualCandidates, regenerating, productionAvailable = false, productionReason = '' }) {
  const videos = book?.videos || [];
  const [selectedVideoId, setSelectedVideoId] = useState(initialVideoId || videos[0]?.id || '');
  const [promptKind, setPromptKind] = useState('video');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [videoPrompt, setVideoPrompt] = useState('');
  const [visualPrompt, setVisualPrompt] = useState('');
  const [h3TraceOpen, setH3TraceOpen] = useState(false);
  const [h3TraceBusy, setH3TraceBusy] = useState(false);
  const [h3Trace, setH3Trace] = useState(null);
  const [h3TraceError, setH3TraceError] = useState('');
  const [promptEditTrace, setPromptEditTrace] = useState(null);
  const selectedIndex = Math.max(0, videos.findIndex(video => video.id === selectedVideoId));
  const selectedVideo = videos[selectedIndex] || null;
  const { displayPrompt, compiledPrompt, smartUnifiedPending, loading: compilingPrompt } = useCompiledVideoPrompt(batchId, book, selectedVideo, settingsRevision);
  const hasVisualPrompt = Boolean(String(visualPrompt || '').trim());
  const hasVideoPrompt = Boolean(String(videoPrompt || '').trim());
  useEffect(() => {
    const first = book?.videos?.find(video => video.id === initialVideoId) || book?.videos?.[0] || null;
    setSelectedVideoId(first?.id || '');
    setVideoPrompt(first?.videoPrompt || '');
    setVisualPrompt(first?.visualPrompt || '');
    setPromptKind('video');
    setEditing(false);
  }, [book?.id, initialVideoId]);
  useEffect(() => {
    setVideoPrompt(selectedVideo?.videoPrompt || '');
    setVisualPrompt(selectedVideo?.visualPrompt || '');
    setEditing(false);
  }, [selectedVideoId, selectedVideo?.revision]);
  async function savePrompt() {
    if (!selectedVideo) return;
    setSaving(true);
    try {
      const patch = promptKind === 'visual' ? { visualPrompt } : { videoPrompt };
      if (promptKind === 'video' && (book?.directorRevision?.output?.h3_director || book?.directorRevision?.output?.h3Director)) {
        if (!promptEditTrace) throw new Error('编辑版本缺失，请重新打开编辑');
        await compileH3Video(batchId, book.id, h3PromptEditRequest(promptEditTrace, selectedIndex, videoPrompt));
      } else {
        await saveVideoOverride(batchId, book.id, selectedVideo.id, { patch, expectedRevision: Number(selectedVideo.revision || 0) });
      }
      await onSaved?.();
      setEditing(false);
      message.success(promptKind === 'visual' ? '当前分镜画面提示词已保存。' : '当前分镜视频提示词已保存。');
    } catch (error) { message.error(error?.message || '保存分镜提示词失败'); } finally { setSaving(false); }
  }
  async function openH3Trace() {
    setH3TraceOpen(true);
    setH3TraceBusy(true);
    setH3TraceError('');
    try {
      setH3Trace(await getH3Trace(batchId, book.id));
    } catch (error) {
      setH3Trace(null);
      setH3TraceError(error?.message || '读取 H3 Trace 失败');
    } finally {
      setH3TraceBusy(false);
    }
  }
  function move(direction) {
    const next = videos[selectedIndex + direction];
    if (next) setSelectedVideoId(next.id);
  }
	  const activeLabel = promptKind === 'visual' ? '画面提示词' : '分镜视频提示词';
  const submittedVideoPrompt = smartUnifiedPending ? '' : (compiledPrompt || displayPrompt || videoPrompt);
  const activeValue = promptKind === 'visual' ? visualPrompt : editing ? videoPrompt : submittedVideoPrompt;
  const activeReady = promptKind === 'visual' ? hasVisualPrompt : !smartUnifiedPending && Boolean(submittedVideoPrompt.trim());
  const regenerateCurrentPrompt = promptKind === 'visual' ? onRegenerateVisual : onRegenerate;
  const h3Segments = h3Trace?.compilation?.compilation?.segments || [];
  const h3Segment = h3Segments[selectedIndex] || null;
  return <div className="batch-factory-prompt-modal-stack">
    <div className="batch-factory-prompt-modal-head">
      <Space>
        <Tooltip title="上一分镜"><Button aria-label="上一分镜" icon={<LeftOutlined />} disabled={selectedIndex === 0} onClick={() => move(-1)} /></Tooltip>
        <span className="batch-factory-prompt-modal-index">{videos.length ? `${selectedIndex + 1}/${videos.length}` : '0/0'}</span>
        <Tooltip title="下一分镜"><Button aria-label="下一分镜" icon={<RightOutlined />} disabled={!videos.length || selectedIndex >= videos.length - 1} onClick={() => move(1)} /></Tooltip>
      </Space>
      <div className="batch-factory-prompt-modal-tabs" aria-label="提示词类型">
        <button type="button" className={promptKind === 'visual' ? 'is-visual active' : 'is-visual'} disabled={!hasVisualPrompt} onClick={() => setPromptKind('visual')}>画面提示词</button>
        <button type="button" className={promptKind === 'video' ? 'is-video active' : 'is-video'} disabled={!hasVideoPrompt} onClick={() => setPromptKind('video')}>视频提示词</button>
      </div>
    </div>
    {!activeReady ? <Alert type="info" showIcon message={smartUnifiedPending && promptKind === 'video' ? '智能统一待分析' : promptKind === 'visual' ? '请生成画面提示词再查看' : '请生成视频提示词再查看'} description={smartUnifiedPending && promptKind === 'video' ? '智能统一只会在重新生成导演分镜时运行；它会更新最终 VIDEO 提示词，但不会提交视频生成任务。' : '当前分镜尚未有这一类提示词；切换分镜时会保持当前查看类型。'} action={smartUnifiedPending && promptKind === 'video' ? <Button size="small" type="primary" loading={regenerating} onClick={onRegenerate}>重新生成导演分镜</Button> : null} /> : <>
      <label className="shuihuo-form-label batch-factory-prompt-editor-label">{activeLabel}<Input.TextArea rows={14} readOnly={!editing} value={activeValue} onChange={event => promptKind === 'visual' ? setVisualPrompt(event.target.value) : setVideoPrompt(event.target.value)} placeholder={promptKind === 'visual' ? '仅用于生成当前分镜的画面图片' : '会进入当前分镜的最终视频编译'} /></label>
      <div className="batch-factory-prompt-modal-actions">
        <Button type="primary" loading={saving} disabled={!editing || !selectedVideo} onClick={savePrompt}>保存</Button>
        <Tooltip title={promptKind === 'visual' ? '按当前小说原文重新生成画面提示词。' : '按当前小说原文重新生成导演分镜，并重编最终 VIDEO 提示词；不会提交视频生成任务。'}><Button icon={promptKind === 'visual' ? <ReloadOutlined /> : null} loading={regenerating} disabled={regenerating || !regenerateCurrentPrompt} onClick={regenerateCurrentPrompt}>{promptKind === 'visual' ? '重新生成画面提示词' : '重新生成导演分镜'}</Button></Tooltip>
        <Button onClick={async () => {
          if (!editing && promptKind === 'video') {
            if (book?.directorRevision?.output?.h3_director || book?.directorRevision?.output?.h3Director) {
              try {
                const trace = await getH3Trace(batchId, book.id);
                const segment = trace?.compilation?.compilation?.segments?.[selectedIndex];
                if (!segment) throw new Error('分镜编译记录缺失');
                setPromptEditTrace(trace);
                setVideoPrompt(segment.compiled_prompt);
              } catch (error) { message.error(error?.message || '读取分镜失败'); return; }
            } else setVideoPrompt(submittedVideoPrompt);
          }
          setEditing(value => !value);
        }}>{editing ? '完成编辑' : '编辑'}</Button>
        {promptKind === 'visual' ? <Button onClick={() => onGenerateVisual?.(selectedVideo?.id)}>生成图片</Button> : <Tooltip title={productionAvailable ? '为当前分镜生成视频候选版本。' : productionReason}><Button disabled={!productionAvailable || regenerating} loading={regenerating} onClick={() => onGenerateVideo?.(selectedVideo?.id)}>生成视频</Button></Tooltip>}
        <Button onClick={() => promptKind === 'visual' ? onViewVisualCandidates?.(selectedVideo?.id) : onViewVideoCandidates?.(selectedVideo?.id)}>查看候选版本</Button>
        {promptKind === 'video' ? <Button onClick={openH3Trace}>查看 H3 Trace</Button> : null}
        <Button type="text" disabled={regenerating} onClick={() => onRetry?.(selectedVideo?.id)}>重试</Button>
      </div>
    </>}
    <p className="shuihuo-modal-note">{promptKind === 'visual' ? '画面版本从当前书的人物场景预设中管理和生成。' : editing ? '编辑的是当前分镜的视频描述；保存后会按已启用资产与约束重新编译最终视频提示词。' : compilingPrompt ? '正在读取已启用资产与约束编译的最终视频提示词。' : '视频版本只在当前分镜内生成和切换，不会覆盖其他分镜。'}</p>
    <Modal title="H3 分镜编译与提交 Trace" open={h3TraceOpen} onCancel={() => setH3TraceOpen(false)} footer={null} width={980}>
      {h3TraceBusy ? <Alert type="info" showIcon message="正在读取编译 Trace…" /> : h3TraceError ? <Alert type="error" showIcon message="编译 Trace 读取失败" description={h3TraceError} /> : h3Trace?.legacy ? <Alert type="warning" showIcon message="旧数据只读" description={h3Trace?.notice || '旧版导演数据，无完整结构化 Trace'} /> : h3Segment ? <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Descriptions size="small" bordered column={2} items={[
          { key: 'director', label: '导演修订', children: h3Trace?.director_revision_id || '—' },
          { key: 'compilation', label: '编译修订', children: h3Trace?.compilation?.id || '—' },
          { key: 'segment', label: '分段', children: h3Segment.segment_key || `VIDEO ${selectedIndex + 1}` },
          { key: 'duration', label: '确定性时长', children: `${h3Segment.canonical_duration_ms || 0}ms → ${h3Segment.request_duration_ms || 0}ms` },
          { key: 'hash', label: 'Prompt Hash', children: h3Segment.compiled_prompt_hash || '—', span: 2 }
        ]} />
        <label className="shuihuo-form-label">实际提交视频模型的 H3 最终 Prompt<Input.TextArea rows={16} readOnly value={h3Segment.compiled_prompt || ''} /></label>
        <label className="shuihuo-form-label">Compile Trace<Input.TextArea rows={12} readOnly value={JSON.stringify(h3Segment.compile_trace || {}, null, 2)} /></label>
      </Space> : <Alert type="info" showIcon message="当前分镜尚无编译记录" />}
    </Modal>
  </div>;
}
function PassiveMediaPoster({ className = 'batch-factory-media-poster', label, detail = '已生成 · 点击查看' }) {
  return <span className={className} role="img" aria-label={label}><PictureOutlined /><b>{label}</b><small>{detail}</small></span>;
}

function batchFactoryPassiveMediaUrl(media) {
  return String(media?.mediaUrl || media?.outputUrl || '').trim();
}

function batchFactoryPassivePosterUrl(media) {
  return String(
    media?.posterUrl
    || media?.thumbnailUrl
    || media?.coverUrl
    || media?.previewImageUrl
    || media?.firstFrameUrl
    || ''
  ).trim();
}

function PassiveMediaPreview({
  media,
  className = 'batch-factory-media-poster',
  label = '视频预览',
  detail = '已生成',
  onLoadedMetadata
}) {
  const mediaUrl = batchFactoryPassiveMediaUrl(media);
  const posterUrl = batchFactoryPassivePosterUrl(media);

  if (!mediaUrl && !posterUrl) {
    return <PassiveMediaPoster className={className} label={label} detail={detail} />;
  }

  const primeVideoFrame = event => {
    onLoadedMetadata?.(event);
    const element = event.currentTarget;
    const duration = Number(element?.duration || 0);
    const target = Number.isFinite(duration) && duration > 0 ? Math.min(0.08, duration / 2) : 0.05;
    try {
      if (element && Number(element.currentTime || 0) < 0.001 && target > 0) element.currentTime = target;
    } catch (_) {}
  };

  const ensureDecodedFrame = event => {
    const element = event.currentTarget;
    const duration = Number(element?.duration || 0);
    const target = Number.isFinite(duration) && duration > 0 ? Math.min(0.08, duration / 2) : 0.05;
    try {
      if (element && Number(element.currentTime || 0) < 0.001 && target > 0) element.currentTime = target;
    } catch (_) {}
  };

  return <span className={`${className} has-media`} role="img" aria-label={label}>
    {posterUrl
      ? <img src={posterUrl} alt="" loading="lazy" />
      : <ProductionMediaBoundary showDownload={false}><video
          src={mediaUrl}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          tabIndex={-1}
          aria-hidden="true"
          onLoadedMetadata={primeVideoFrame}
          onLoadedData={ensureDecodedFrame}
        /></ProductionMediaBoundary>}
  </span>;
}


function batchFactoryParseMediaRatio(value, fallback = 9 / 16) {
  const parts = String(value || '').trim().split(/[:/x×]/).map(Number).filter(Number.isFinite);
  if (parts.length >= 2 && parts[0] > 0 && parts[1] > 0) return parts[0] / parts[1];
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function batchFactoryMediaOrientation(ratio) {
  const safe = Number.isFinite(Number(ratio)) && Number(ratio) > 0 ? Number(ratio) : 9 / 16;
  if (Math.abs(safe - 1) < 0.035) return 'square';
  return safe > 1 ? 'landscape' : 'portrait';
}

function batchFactoryRatioText(width, height, fallbackRatio = 9 / 16) {
  const w = Math.round(Number(width || 0));
  const h = Math.round(Number(height || 0));
  if (w > 0 && h > 0) {
    function gcd(a, b) { return b ? gcd(b, a % b) : a; }
    const divisor = gcd(w, h) || 1;
    return `${Math.round(w / divisor)}:${Math.round(h / divisor)}`;
  }
  const ratio = Number(fallbackRatio) > 0 ? Number(fallbackRatio) : 9 / 16;
  if (Math.abs(ratio - 16 / 9) < 0.04) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.04) return '9:16';
  if (Math.abs(ratio - 1) < 0.04) return '1:1';
  return ratio > 1 ? `${Math.round(ratio * 100)}:100` : `100:${Math.round(100 / ratio)}`;
}

function batchFactoryStableMediaLabel(prefix, id) {
  const compact = String(id || '').replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase();
  return compact ? `${prefix}-${compact}` : prefix;
}
function InlineMediaLibrary({ book, versionsByVideo, productionStatus, mergeJob, aspectRatio = '16:9', selectedVideoId: controlledSelectedVideoId = '', onSelectedVideoChange, onManage, onOpenMerge }) {
  const videos = book?.videos || [];
  const mediaVersions = versionsByVideo instanceof Map ? versionsByVideo : new Map();
  const videoProgress = batchFactoryVideoProgress(book, productionStatus);
  const [localSelectedVideoId, setLocalSelectedVideoId] = useState(videos[0]?.id || '');
  const selectedVideoId = controlledSelectedVideoId || localSelectedVideoId;
  const selectVideo = nextId => {
    const value = String(nextId || '');
    setLocalSelectedVideoId(value);
    onSelectedVideoChange?.(value);
  };
  const selectedIndex = Math.max(0, videos.findIndex(video => video.id === selectedVideoId));
  const video = videos[selectedIndex] || null;
  const versions = video ? (mediaVersions.get(video.id) || []) : [];
  const primary = primaryMediaVersion(video, versions);
  const currentProgress = video ? videoProgress.byVideo.get(String(video.id || '')) : null;
  const mediaFrameLayout = batchFactoryMediaOrientation(batchFactoryParseMediaRatio(video?.settingsState?.patch?.aspectRatio || video?.aspectRatio || aspectRatio, 16 / 9));
  const candidates = versions.filter(version => version.id !== primary?.id).slice(-4).reverse();
  useEffect(() => { if (!controlledSelectedVideoId) setLocalSelectedVideoId(book?.videos?.[0]?.id || ''); }, [book?.id]);
  useEffect(() => { if (!videos.some(item => item.id === selectedVideoId) && videos[0]?.id) selectVideo(videos[0].id); }, [videos.map(item => item.id).join('|')]);
  function move(direction) { const next = videos[selectedIndex + direction]; if (next) selectVideo(next.id); }
  if (!video) return <div className="batch-factory-cell-shell batch-factory-inline-media is-empty"><div className="batch-factory-cell-empty">AI 推理后显示该书的分镜视频。</div></div>;
  const running = currentProgress?.status === 'running' || currentProgress?.status === 'queued';
  const mergeStatus = String(mergeJob?.status || '').toLowerCase();
  const mergeReady = mergeStatus === 'succeeded' && String(mergeJob?.outputUrl || '').trim();
  const mergeText = mergeReady ? `最终成片 ${batchFactoryStableMediaLabel('M', mergeJob.id)} · ${mergeJobSpeed(mergeJob).toFixed(1)}x`
    : mergeStatus === 'running' || mergeStatus === 'queued' ? '最终成片 · 合成中'
    : mergeStatus === 'failed' ? '最终成片 · 合成失败' : '最终成片 · 尚未合成';
  return <div className={`batch-factory-cell-shell batch-factory-inline-media is-${mediaFrameLayout}`}>
    <header className="batch-factory-cell-head">
      <div><b>{storyboardVideoLabel(video, selectedIndex)}</b><small>{running ? '正在生成' : primary?.mediaUrl ? '当前主版本' : '尚无可用视频'}</small></div>
      <span className={`batch-factory-cell-state${primary?.mediaUrl ? ' is-ready' : running ? ' is-running' : ''}`}>{primary?.mediaUrl ? batchFactoryStableMediaLabel('V', primary.id) : running ? '生成中' : '待生成'}</span>
    </header>
    <div className="batch-factory-cell-content batch-factory-video-content batch-factory-video-content-v13">
      <button type="button" className={`batch-factory-inline-media-primary${running ? ' is-producing' : ''}`} onClick={() => onManage?.(video.id)}>
        {primary?.mediaUrl ? <PassiveMediaPreview className="batch-factory-inline-media-poster" media={primary} label={`分镜 ${selectedIndex + 1} 已生成`} /> : <>{running ? <LoadingOutlined spin /> : <CloudUploadOutlined />}<span>{currentProgress?.message || '当前分镜暂无视频'}</span></>}
      </button>
      <div className="batch-factory-inline-media-versions"><span>候选</span>{candidates.map((candidate, index) => <button type="button" key={candidate.id} className="batch-factory-inline-media-version" onClick={() => onManage?.(video.id)}>{candidate.mediaUrl ? <PassiveMediaPreview className="batch-factory-inline-media-poster is-candidate" media={candidate} label={`候选 ${index + 1}`} detail="已生成" /> : <PictureOutlined />}</button>)}<button type="button" className="batch-factory-inline-media-version is-more" onClick={() => onManage?.(video.id)} title="打开完整片段库">•••</button></div>
      <button type="button" className={`batch-factory-inline-merge-status is-${mergeStatus || 'idle'}`} onClick={() => onOpenMerge?.()}><span>{mergeText}</span><b>查看</b></button>
    </div>
    <div className="batch-factory-cell-pager"><button type="button" disabled={selectedIndex === 0} onClick={() => move(-1)}><LeftOutlined /></button><span>{selectedIndex + 1} / {videos.length}</span><button type="button" disabled={selectedIndex >= videos.length - 1} onClick={() => move(1)}><RightOutlined /></button></div>
  </div>;
}

function MediaVersionPanel({ book, batchId, versionsByVideo, productionStatus, mergeJob, mergeJobs = [], mergeSettings = {}, mergeSpeed, onMergeSpeedChange, onMerge, onUpload, mergeAvailable = false, mergeReason = '', merging = false, onSaved, onDeleted, onRegenerate, onRetry, regenerating, productionAvailable = false, productionReason = '', initialVideoId = '', initialTab = 'clips' }) {
  const videos = book?.videos || [];
  const videoProgress = batchFactoryVideoProgress(book, productionStatus);
  const mediaVersions = versionsByVideo instanceof Map ? versionsByVideo : new Map();
  const [viewerKind, setViewerKind] = useState(initialTab === 'merges' ? 'merge' : 'video');
  const [selectedVideoId, setSelectedVideoId] = useState(initialVideoId || videos[0]?.id || '');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [selectedMergePreviewId, setSelectedMergePreviewId] = useState('');
  const [savingTaskId, setSavingTaskId] = useState('');
  const [playRequested, setPlayRequested] = useState(false);
  const [mediaMetrics, setMediaMetrics] = useState({});
  const [primaryOverrides, setPrimaryOverrides] = useState({});
  const [followAudio, setFollowAudio] = useState(mergeSettings.audioMergeEnabled === true);
  const [audioDurationSeconds, setAudioDurationSeconds] = useState(Number(mergeSettings.audioDurationSeconds || 0));
  const [audioBusy, setAudioBusy] = useState(false);
  const [pendingUploadKey, setPendingUploadKey] = useState('');
  const [sheetAnchor, setSheetAnchor] = useState('collapsed');
  const [sheetOffset, setSheetOffset] = useState(null);
  const [sheetDragging, setSheetDragging] = useState(false);
  const sheetRef = useRef(null);
  const sheetDragRef = useRef(null);

  const completedMerges = mergeJobs.filter(job => job?.status === 'succeeded' && String(job?.outputUrl || '').trim());
  const mergeJobsNewest = [...mergeJobs].sort((left, right) => String(right?.updatedAt || right?.createdAt || '').localeCompare(String(left?.updatedAt || left?.createdAt || '')));
  const selectedUpload = book?.settingsState?.patch?.primaryUploadSource || {};
  const selectedMerge = selectedUpload?.kind === 'merged'
    ? completedMerges.find(job => job.id === selectedUpload.mergeJobId) || null
    : defaultBookMerge(mergeJobs);
  const mergedReady = selectedMerge?.status === 'succeeded' && String(selectedMerge?.outputUrl || '').trim();
  const uploadVideo = selectedUpload?.kind === 'video' ? videos.find(video => video.id === selectedUpload.videoId) : null;
  const uploadVersion = uploadVideo ? (mediaVersions.get(uploadVideo.id) || []).find(version => version.id === selectedUpload.taskId) || null : null;
  const defaultRatio = batchFactoryParseMediaRatio(mergeSettings.aspectRatio, 9 / 16);

  function label(video) {
    return video?.label || video?.title || `分镜 ${videos.findIndex(item => item.id === video?.id) + 1}`;
  }

  function productionProgressFor(video) {
    return videoProgress.byVideo.get(String(video?.id || '')) || null;
  }

  function fallbackRatioFor(video) {
    return batchFactoryParseMediaRatio(
      video?.settingsState?.patch?.aspectRatio || video?.aspectRatio || mergeSettings.aspectRatio,
      defaultRatio
    );
  }

  function mediaInfo(version, video) {
    const cached = mediaMetrics[String(version?.id || '')] || {};
    const width = Number(cached.width || version?.width || version?.videoWidth || 0);
    const height = Number(cached.height || version?.height || version?.videoHeight || 0);
    const ratio = width > 0 && height > 0 ? width / height : fallbackRatioFor(video);
    return {
      width,
      height,
      ratio,
      orientation: batchFactoryMediaOrientation(ratio),
      ratioText: batchFactoryRatioText(width, height, ratio)
    };
  }

  function mergeInfo(job) {
    const key = `merge:${String(job?.id || '')}`;
    const cached = mediaMetrics[key] || {};
    const width = Number(cached.width || job?.width || job?.videoWidth || 0);
    const height = Number(cached.height || job?.height || job?.videoHeight || 0);
    const ratio = width > 0 && height > 0 ? width / height : defaultRatio;
    return {
      key,
      width,
      height,
      ratio,
      orientation: batchFactoryMediaOrientation(ratio),
      ratioText: batchFactoryRatioText(width, height, ratio)
    };
  }

  function rememberMediaMetrics(key, event) {
    const element = event.currentTarget;
    if (!(element?.videoWidth > 0 && element?.videoHeight > 0)) return;
    const next = {
      width: element.videoWidth,
      height: element.videoHeight,
      duration: Number.isFinite(element.duration) ? element.duration : 0
    };
    setMediaMetrics(current => {
      const previous = current[key];
      if (previous?.width === next.width && previous?.height === next.height && previous?.duration === next.duration) return current;
      return { ...current, [key]: next };
    });
  }

  function primeViewerFrame(key, event) {
    rememberMediaMetrics(key, event);
    const element = event.currentTarget;
    if (!element || !element.paused || Number(element.currentTime || 0) >= 0.001) return;
    const duration = Number(element.duration || 0);
    const target = Number.isFinite(duration) && duration > 0 ? Math.min(0.06, duration / 2) : 0.04;
    try {
      if (target > 0) element.currentTime = target;
    } catch (_) {}
  }

  function primaryFor(video, list) {
    const overrideId = primaryOverrides[String(video?.id || '')];
    return (overrideId ? list.find(version => version.id === overrideId) : null) || primaryMediaVersion(video, list);
  }

  function videoState(video) {
    const list = mediaVersions.get(video.id) || [];
    const main = primaryFor(video, list);
    const progress = productionProgressFor(video);
    const active = ['running', 'queued'].includes(String(progress?.status || '').toLowerCase());
    const failed = String(progress?.status || '').toLowerCase() === 'failed';
    return { list, main, progress, active, failed, ready: Boolean(main?.mediaUrl) };
  }

  const selectedVideo = videos.find(video => video.id === selectedVideoId) || videos[0] || null;
  const selectedVideoState = selectedVideo ? videoState(selectedVideo) : { list: [], main: null };
  const selectedVersion = selectedVideoState.list.find(version => version.id === selectedVersionId)
    || selectedVideoState.main
    || selectedVideoState.list.at(-1)
    || null;
  const mergePreview = mergeJobs.find(job => job.id === selectedMergePreviewId)
    || selectedMerge
    || mergeJobsNewest[0]
    || null;

  const readyVideos = videos.filter(video => videoState(video).ready);
  const missingVideos = videos.filter(video => !videoState(video).ready);
  const mergeReady = videos.length > 0 && readyVideos.length === videos.length;

  useEffect(() => {
    const next = videos.find(video => video.id === initialVideoId) || videos[0] || null;
    setViewerKind(initialTab === 'merges' ? 'merge' : 'video');
    setSelectedVideoId(next?.id || '');
    setSelectedVersionId('');
    setSelectedMergePreviewId('');
    setPlayRequested(false);
    setMediaMetrics({});
    setPrimaryOverrides({});
    setSheetAnchor('collapsed');
    setSheetOffset(null);
  }, [book?.id, initialVideoId, initialTab]);

  const fixedSingleVideo = mergeSettings.fixedSingleVideo === true;
  useEffect(() => {
    setFollowAudio(fixedSingleVideo ? false : mergeSettings.audioMergeEnabled === true);
    setAudioDurationSeconds(Number(mergeSettings.audioDurationSeconds || 0));
  }, [book?.id, fixedSingleVideo, mergeSettings.audioMergeEnabled, mergeSettings.audioDurationSeconds]);

  useEffect(() => {
    if (!selectedVideo) {
      if (selectedVersionId) setSelectedVersionId('');
      return;
    }
    if (selectedVersionId && selectedVideoState.list.some(version => version.id === selectedVersionId)) return;
    setSelectedVersionId(selectedVideoState.main?.id || selectedVideoState.list.at(-1)?.id || '');
  }, [selectedVideoId, selectedVersionId, selectedVideoState.main?.id, selectedVideoState.list.map(version => version.id).join('|')]);

  useEffect(() => {
    if (selectedMergePreviewId && mergeJobs.some(job => job.id === selectedMergePreviewId)) return;
    setSelectedMergePreviewId(selectedMerge?.id || mergeJobsNewest[0]?.id || '');
  }, [selectedMergePreviewId, selectedMerge?.id, mergeJobsNewest.map(job => job.id).join('|')]);

  function uploadSourceKey(source = selectedUpload) {
    if (source?.kind === 'video' && source.videoId && source.taskId) return `video:${source.videoId}:${source.taskId}`;
    if (source?.kind === 'merged' && source.mergeJobId) return `merged:${source.mergeJobId}`;
    if (selectedMerge?.id) return `merged:${selectedMerge.id}`;
    return '';
  }

  useEffect(() => {
    setPendingUploadKey(uploadSourceKey());
  }, [book?.revision, selectedUpload?.kind, selectedUpload?.videoId, selectedUpload?.taskId, selectedUpload?.mergeJobId, selectedMerge?.id]);

  function selectVideoPreview(video, version = null, play = true) {
    if (!video) return;
    const state = videoState(video);
    const nextVersion = version || state.main || state.list.at(-1) || null;
    setViewerKind('video');
    setSelectedVideoId(video.id);
    setSelectedVersionId(nextVersion?.id || '');
    setPlayRequested(Boolean(play && nextVersion?.mediaUrl));
  }

  function selectMergePreview(job, play = true) {
    if (!job) return;
    setViewerKind('merge');
    setSelectedMergePreviewId(job.id);
    setPlayRequested(Boolean(play && job.status === 'succeeded' && String(job.outputUrl || '').trim()));
  }

  async function choosePrimary(video, version) {
    if (!video || !version || savingTaskId) return;
    const key = String(video.id);
    const previous = primaryOverrides[key];
    setPrimaryOverrides(current => ({ ...current, [key]: version.id }));
    setSavingTaskId(version.id);
    setSelectedVideoId(video.id);
    setSelectedVersionId(version.id);
    setViewerKind('video');
    setPlayRequested(Boolean(version.mediaUrl));
    try {
      await saveVideoOverride(batchId, book.id, video.id, { patch: { primaryMediaTaskId: version.id }, expectedRevision: Number(video.revision || 0) });
      await onSaved?.();
      message.success(`${label(video)} 已切换到 ${batchFactoryStableMediaLabel('V', version.id)}；下一次合成将读取它。`);
    } catch (error) {
      setPrimaryOverrides(current => {
        const next = { ...current };
        if (previous) next[key] = previous;
        else delete next[key];
        return next;
      });
      message.error(error?.message || '切换分镜主版本失败');
    } finally {
      setSavingTaskId('');
    }
  }

  async function removeCandidate(video, version) {
    if (!video || !version || savingTaskId) return;
    setSavingTaskId(`delete-${version.id}`);
    try {
      await deleteProductionTask(batchId, book.id, video.id, version.id);
      await onDeleted?.();
      message.success('候选视频已从当前书片段库移除。');
    } catch (error) {
      message.error(error?.message || '删除候选视频失败');
    } finally {
      setSavingTaskId('');
    }
  }

  async function chooseUploadSource(source) {
    if (!book?.id || savingTaskId) return;
    setSavingTaskId(source.kind === 'merged' ? `upload-merged-${source.mergeJobId}` : `upload-video-${source.videoId}`);
    try {
      await saveBookOverride(batchId, book.id, { patch: { primaryUploadSource: source }, expectedRevision: Number(book.revision || 0) });
      await onSaved?.();
      setPendingUploadKey(uploadSourceKey(source));
      message.success(source.kind === 'merged'
        ? '合成成片已设为 121 上传主视频。'
        : `${source.videoId === videos[0]?.id ? '首分镜已设为上传主视频和作品封面。' : '分镜主版本已设为 121 上传主视频。'}`);
    } catch (error) {
      message.error(error?.message || '设置上传主视频失败');
    } finally {
      setSavingTaskId('');
    }
  }

  async function applyPendingUploadSource() {
    if (!pendingUploadKey) return;
    const [kind, first, second] = pendingUploadKey.split(':');
    if (kind === 'merged' && first) {
      await chooseUploadSource({ kind: 'merged', mergeJobId: first });
      return;
    }
    if (kind === 'video' && first && second) {
      await chooseUploadSource({ kind: 'video', videoId: first, taskId: second });
    }
  }

  const uploadOptions = [
    ...completedMerges.map(job => ({
      value: `merged:${job.id}`,
      label: `成片 ${batchFactoryStableMediaLabel('M', job.id)} · ${mergeJobSpeed(job).toFixed(1)}x`
    })),
    ...videos.flatMap(video => {
      const state = videoState(video);
      return state.main?.mediaUrl ? [{
        value: `video:${video.id}:${state.main.id}`,
        label: `${label(video)} · 主 ${batchFactoryStableMediaLabel('V', state.main.id)}`
      }] : [];
    })
  ];

  const uploadSourceText = selectedUpload?.kind === 'video'
    ? (uploadVideo && uploadVersion
      ? `${label(uploadVideo)} · ${batchFactoryStableMediaLabel('V', uploadVersion.id)}`
      : '所选分镜来源暂不可用')
    : mergedReady
      ? `合成成片 · ${batchFactoryStableMediaLabel('M', selectedMerge?.id)} · ${mergeJobSpeed(selectedMerge).toFixed(1)}x`
      : '尚未选择可上传视频';

  function sheetAnchors(height) {
    const full = 0;
    const collapsed = Math.max(0, height - 74);
    const half = Math.max(0, height - Math.min(320, height - 74));
    return { full, half, collapsed };
  }

  function sheetAnchorOffset(anchor = sheetAnchor) {
    const height = sheetRef.current?.getBoundingClientRect().height || 520;
    return sheetAnchors(height)[anchor] ?? 0;
  }

  function rubberBand(value, min, max) {
    if (value < min) {
      const distance = min - value;
      return min - (distance * 0.28) / (1 + distance / 260);
    }
    if (value > max) {
      const distance = value - max;
      return max + (distance * 0.28) / (1 + distance / 260);
    }
    return value;
  }

  function startSheetDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const startOffset = sheetOffset == null ? sheetAnchorOffset() : sheetOffset;
    sheetDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffset,
      lastY: event.clientY,
      lastTime: performance.now(),
      velocity: 0
    };
    setSheetDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveSheetDrag(event) {
    const drag = sheetDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const now = performance.now();
    const deltaTime = Math.max(1, now - drag.lastTime);
    const instantVelocity = (event.clientY - drag.lastY) / deltaTime;
    drag.velocity = drag.velocity * 0.72 + instantVelocity * 0.28;
    drag.lastY = event.clientY;
    drag.lastTime = now;
    const height = sheetRef.current?.getBoundingClientRect().height || 520;
    const anchors = sheetAnchors(height);
    setSheetOffset(rubberBand(drag.startOffset + event.clientY - drag.startY, anchors.full, anchors.collapsed));
  }

  function endSheetDrag(event) {
    const drag = sheetDragRef.current;
    if (!drag || (event?.pointerId != null && drag.pointerId !== event.pointerId)) return;
    const height = sheetRef.current?.getBoundingClientRect().height || 520;
    const anchors = sheetAnchors(height);
    const current = sheetOffset == null ? sheetAnchorOffset() : sheetOffset;
    const velocity = drag.velocity;
    const order = ['full', 'half', 'collapsed'];
    let target;
    if (Math.abs(velocity) > 0.42) {
      const currentIndex = order.indexOf(sheetAnchor);
      const nextIndex = velocity < 0 ? Math.max(0, currentIndex - 1) : Math.min(order.length - 1, currentIndex + 1);
      target = order[nextIndex];
    } else {
      target = order.reduce((best, name) => Math.abs(current - anchors[name]) < Math.abs(current - anchors[best]) ? name : best, 'collapsed');
    }
    sheetDragRef.current = null;
    setSheetDragging(false);
    setSheetAnchor(target);
    setSheetOffset(null);
  }

  function toggleSheet() {
    setSheetOffset(null);
    setSheetAnchor(current => current === 'collapsed' ? 'half' : current === 'half' ? 'full' : 'collapsed');
  }

  async function persistMediaAudioPatch(patch) {
    const result = await saveBookOverrideWithRetry(batchId, book.id, Number(book?.revision || 0), { patch });
    await onSaved?.();
    return result;
  }

  async function measureMergeAudioDuration({ force = false } = {}) {
    if (audioBusy || fixedSingleVideo) return Number(audioDurationSeconds || 0);
    const input = batchFactoryBookAudioInput(book);
    const tts = await batchFactoryBookTts(mergeSettings);
    const fingerprint = batchFactoryAudioFingerprint(input, tts);
    const savedFingerprint = String(mergeSettings.audioDurationFingerprint || '');
    const savedSeconds = Number(mergeSettings.audioDurationSeconds || 0);
    if (!force && savedSeconds > 0 && (mergeSettings.audioDurationManual === true || savedFingerprint === fingerprint)) {
      setAudioDurationSeconds(savedSeconds);
      return savedSeconds;
    }
    setAudioBusy(true);
    try {
      const measured = await generateBatchFactoryBookAudioMeasurement(book, mergeSettings);
      setAudioDurationSeconds(measured.durationSeconds);
      await persistMediaAudioPatch({ audioDurationSeconds: measured.durationSeconds, audioDurationFingerprint: measured.fingerprint, audioDurationManual: false });
      message.success(`已读取当前书配音时长：${measured.durationSeconds.toFixed(2)} 秒`);
      return measured.durationSeconds;
    } catch (error) {
      message.error(error?.message || '读取当前书配音时长失败；仍可手动填写秒数');
      return 0;
    } finally { setAudioBusy(false); }
  }

  async function toggleFollowAudio(checked) {
    if (fixedSingleVideo) { message.warning('固定开头模式只生产 VIDEO01，请先关闭固定开头。'); return; }
    setFollowAudio(checked);
    try {
      await persistMediaAudioPatch({ audioMergeEnabled: checked });
      if (checked && Number(audioDurationSeconds || 0) <= 0) await measureMergeAudioDuration();
    } catch (error) { message.error(error?.message || '保存合并跟随配音设置失败'); }
  }

  async function persistManualAudioDuration() {
    const seconds = Number(audioDurationSeconds || 0);
    if (!(seconds > 0)) return;
    try {
      await persistMediaAudioPatch({ audioDurationSeconds: seconds, audioDurationManual: true });
    } catch (error) { message.error(error?.message || '保存配音时长失败'); }
  }

  async function runCurrentMerge() {
    if (!mergeReady || !mergeAvailable || merging) return;
    let seconds = Number(audioDurationSeconds || 0);
    if (followAudio && seconds <= 0) seconds = await measureMergeAudioDuration();
    if (followAudio && seconds <= 0) return;
    onMerge?.({ speed: Number(mergeSpeed || 1), followAudio, audioDurationSeconds: seconds });
  }

  function renderThumb(media, info, labelText, className = 'batch-factory-media-pickstation-thumb') {
    return <PassiveMediaPreview
      media={media}
      className={`${className} is-${info.orientation}`}
      label={labelText}
      onLoadedMetadata={event => rememberMediaMetrics(String(media?.id || ''), event)}
    />;
  }

  function renderMergeRail() {
    const current = mergePreview || selectedMerge || mergeJobsNewest[0] || null;
    const currentInfo = mergeInfo(current);
    return <section className={`batch-factory-media-pickstation-rail-card is-merge${viewerKind === 'merge' ? ' is-active' : ''}`}>
      <header>
        <div><span className="batch-factory-media-pickstation-index">成</span><b>合成成片</b></div>
        <small>{current ? `当前 ${batchFactoryStableMediaLabel('M', current.id)}` : '尚无成片'}</small>
      </header>
      {current ? <button type="button" className="batch-factory-media-pickstation-main" onClick={() => selectMergePreview(current)}>
        {current.status === 'succeeded' && String(current.outputUrl || '').trim()
          ? renderThumb(current, currentInfo, `合成成片 ${batchFactoryStableMediaLabel('M', current.id)}`)
          : <PassiveMediaPoster className="batch-factory-media-pickstation-thumb is-landscape" label="等待成片" detail={current.status === 'failed' ? '合成失败' : '处理中'} />}
        <span><b>{batchFactoryStableMediaLabel('M', current.id)}</b><small>{mergeJobSpeed(current).toFixed(1)}x · {currentInfo.ratioText}</small><em>{selectedMerge?.id === current.id ? '当前上传来源' : '历史成片'}</em></span>
      </button> : <div className="batch-factory-media-pickstation-empty">全部分镜选定主版本后，可在底部发起合成。</div>}
      <div className="batch-factory-media-pickstation-versions">
        {mergeJobsNewest.map(job => {
          const info = mergeInfo(job);
          const selected = job.id === current?.id;
          return <button
            type="button"
            key={job.id}
            className={`batch-factory-media-pickstation-version${selected ? ' is-selected' : ''}`}
            style={{ '--bf-media-ratio': info.ratio }}
            onClick={() => { setSelectedMergePreviewId(job.id); selectMergePreview(job); }}
            title={`查看 ${batchFactoryStableMediaLabel('M', job.id)}`}
          >
            <PassiveMediaPreview media={job} className="batch-factory-media-pickstation-version-media" label={batchFactoryStableMediaLabel('M', job.id)} onLoadedMetadata={event => rememberMediaMetrics(info.key, event)} />
            <span>{batchFactoryStableMediaLabel('M', job.id)}</span>
          </button>;
        })}
        <Button size="small" className="batch-factory-media-pickstation-add" onClick={() => { setSheetAnchor('half'); setSheetOffset(null); }} disabled={!mergeReady}>＋</Button>
      </div>
    </section>;
  }

  function renderVideoRail(video, index) {
    const state = videoState(video);
    const main = state.main;
    const info = mediaInfo(main, video);
    const active = viewerKind === 'video' && video.id === selectedVideoId;
    const uploadMain = selectedUpload?.kind === 'video' && selectedUpload.videoId === video.id && selectedUpload.taskId === main?.id;
    return <section key={video.id} className={`batch-factory-media-pickstation-rail-card${active ? ' is-active' : ''}`}>
      <header>
        <div><span className="batch-factory-media-pickstation-index">{String(index + 1).padStart(2, '0')}</span><b>{label(video)}</b></div>
        <small>{main ? `主 ${batchFactoryStableMediaLabel('V', main.id)}` : state.active ? '生成中' : state.failed ? '失败' : '待生成'}</small>
      </header>
      {main?.mediaUrl ? <button type="button" className="batch-factory-media-pickstation-main" onClick={() => selectVideoPreview(video, main)}>
        {renderThumb(main, info, `${label(video)} 主版本`)}
        <span><b>{batchFactoryStableMediaLabel('V', main.id)} · {info.ratioText}</b><small>{main.actualDurationSeconds ? `${Number(main.actualDurationSeconds).toFixed(1)}s · ` : ''}{state.list.length} 个版本</small><em>{uploadMain ? '上传来源' : '合成主版本'}</em></span>
      </button> : <button type="button" className="batch-factory-media-pickstation-main is-empty" onClick={() => selectVideoPreview(video, null, false)}>
        <PassiveMediaPoster className="batch-factory-media-pickstation-thumb is-landscape" label={`分镜 ${index + 1}`} detail={state.active ? '生成中' : state.failed ? '生成失败' : '暂无视频'} />
        <span><b>{state.progress?.message || '暂无可用主版本'}</b><small>{state.active ? '任务会自动刷新' : '生成成功后显示版本'}</small></span>
      </button>}
      <div className="batch-factory-media-pickstation-versions">
        {state.list.map(version => {
          const versionInfo = mediaInfo(version, video);
          const isPrimary = version.id === main?.id;
          const isUpload = selectedUpload?.kind === 'video' && selectedUpload.videoId === video.id && selectedUpload.taskId === version.id;
          return <span className="batch-factory-media-pickstation-version-wrap" key={version.id}>
            <button
              type="button"
              className={`batch-factory-media-pickstation-version${isPrimary ? ' is-selected' : ''}`}
              style={{ '--bf-media-ratio': versionInfo.ratio }}
              onClick={() => choosePrimary(video, version)}
              disabled={savingTaskId === version.id}
              title={isPrimary ? '当前合成主版本' : `切换到 ${batchFactoryStableMediaLabel('V', version.id)} 并作为合成主版本`}
            >
              <PassiveMediaPreview media={version} className="batch-factory-media-pickstation-version-media" label={batchFactoryStableMediaLabel('V', version.id)} onLoadedMetadata={event => rememberMediaMetrics(String(version.id), event)} />
              <span>{batchFactoryStableMediaLabel('V', version.id)}</span>
              {isUpload ? <i>传</i> : null}
            </button>
            {!isPrimary && !isUpload ? <Popconfirm title="移除候选版本？" description="只移除当前书片段库引用，不删除远端媒体或历史合成记录。" okText="移除" cancelText="取消" onConfirm={() => removeCandidate(video, version)}>
              <button type="button" className="batch-factory-media-pickstation-version-remove" aria-label={`移除 ${batchFactoryStableMediaLabel('V', version.id)}`}>×</button>
            </Popconfirm> : null}
          </span>;
        })}
        <Tooltip title={productionAvailable ? '为此分镜再生成一个候选版本；当前主版本保持不变。' : productionReason}>
          <Button size="small" className="batch-factory-media-pickstation-add" loading={regenerating && active} disabled={!productionAvailable || regenerating || state.active} onClick={() => onRegenerate?.(video.id)}>＋</Button>
        </Tooltip>
        {state.failed ? <Tooltip title={productionAvailable ? '重试当前分镜最后失败的视频任务。' : productionReason}><Button size="small" danger disabled={!productionAvailable || regenerating} onClick={() => onRetry?.(video.id)}>重试</Button></Tooltip> : null}
      </div>
    </section>;
  }

  const viewerMerge = viewerKind === 'merge' ? mergePreview : null;
  const viewerVideo = viewerKind === 'video' ? selectedVideo : null;
  const viewerVersion = viewerKind === 'video' ? selectedVersion : null;
  const viewerInfo = viewerKind === 'merge' ? mergeInfo(viewerMerge) : mediaInfo(viewerVersion, viewerVideo);
  const viewerUrl = viewerKind === 'merge'
    ? String(viewerMerge?.outputUrl || '').trim()
    : String(viewerVersion?.mediaUrl || '').trim();
  const viewerTitle = viewerKind === 'merge'
    ? (viewerMerge ? `合成成片 ${batchFactoryStableMediaLabel('M', viewerMerge.id)}` : '合成成片')
    : (viewerVideo ? label(viewerVideo) : '分镜');
  const viewerMeta = viewerKind === 'merge'
    ? (viewerMerge ? `${mergeJobSpeed(viewerMerge).toFixed(1)}x · ${viewerInfo.ratioText}` : '—')
    : (viewerVersion ? `${batchFactoryStableMediaLabel('V', viewerVersion.id)} · ${viewerInfo.ratioText}` : '—');

  const primaryVideoDurationRows = videos.map(video => {
    const main = videoState(video).main;
    if (!main) return { seconds: 0, exact: false };
    const actual = Number(main.actualDurationSeconds || mediaMetrics[String(main.id || '')]?.duration || 0);
    if (actual > 0) return { seconds: actual, exact: true };
    return { seconds: Number(main.requestedDurationSeconds || video.durationSeconds || 0), exact: false };
  });
  const videoTotalSeconds = primaryVideoDurationRows.reduce((sum, item) => sum + (Number.isFinite(item.seconds) ? item.seconds : 0), 0);
  const videoTotalIsExact = primaryVideoDurationRows.length > 0 && primaryVideoDurationRows.every(item => item.exact && item.seconds > 0);
  const autoMergeRateRaw = Number(audioDurationSeconds || 0) > 0 && videoTotalSeconds > 0 ? videoTotalSeconds / Number(audioDurationSeconds) : 0;
  const autoMergeRate = autoMergeRateRaw > 0 ? Math.min(4, Math.max(0.5, autoMergeRateRaw)) : 0;
  const estimatedFinalSeconds = autoMergeRate > 0 ? videoTotalSeconds / autoMergeRate : 0;

  const mergeTooltip = !mergeAvailable
    ? mergeReason
    : !mergeReady
      ? `还有 ${missingVideos.length} 个分镜没有可用主版本`
      : fixedSingleVideo && followAudio
        ? '固定开头模式不可使用合并跟随配音'
        : followAudio && Number(audioDurationSeconds || 0) <= 0
          ? '点击合成时会先自动生成配音并读取真实时长'
          : '按各分镜当前主版本合成；不会覆盖历史成片。';

  const currentSheetOffset = sheetOffset == null ? sheetAnchorOffset() : sheetOffset;

  return <div className="batch-factory-media-pickstation">
    <div className="batch-factory-media-pickstation-topline">
      <span>左侧看片 · 右侧选片 · 小版本点击后立即成为该分镜的合成主版本</span>
      <b>{readyVideos.length}/{videos.length} 分镜已就绪</b>
    </div>

    <div className="batch-factory-media-pickstation-workspace">
      <section className="batch-factory-media-pickstation-viewer">
        <header>
          <div><b>{viewerTitle}</b><small>{viewerMeta}</small></div>
          <Tag color={viewerKind === 'merge' ? 'gold' : 'success'}>{viewerKind === 'merge' ? '成片预览' : '合成主版本'}</Tag>
        </header>
        <div className="batch-factory-media-pickstation-stage">
          <div className={`batch-factory-media-pickstation-frame is-${viewerInfo.orientation}`} style={{ '--bf-media-ratio': viewerInfo.ratio }}>
            {viewerUrl ? <ProductionMediaBoundary showDownload={false}><video
              key={`${viewerKind}:${viewerMerge?.id || viewerVersion?.id || ''}`}
              src={viewerUrl}
              controls
              preload="auto"
              playsInline
              autoPlay={playRequested}
              onLoadedMetadata={event => primeViewerFrame(viewerKind === 'merge' ? viewerInfo.key : String(viewerVersion?.id || ''), event)}
              onLoadedData={event => primeViewerFrame(viewerKind === 'merge' ? viewerInfo.key : String(viewerVersion?.id || ''), event)}
            /></ProductionMediaBoundary> : <div className="batch-factory-media-primary-empty">
              {viewerVideo && videoState(viewerVideo).active ? <LoadingOutlined spin /> : <PictureOutlined />}
              <span>{viewerKind === 'merge' ? '当前没有可播放的合成成片' : '当前分镜暂无可播放视频'}</span>
            </div>}
          </div>
        </div>
        <footer>
          {viewerKind === 'video' && viewerVideo ? <span>正在看 <b>{viewerVersion ? batchFactoryStableMediaLabel('V', viewerVersion.id) : '—'}</b>　｜　合成用 <b>{videoState(viewerVideo).main ? batchFactoryStableMediaLabel('V', videoState(viewerVideo).main.id) : '未选择'}</b></span>
            : <span>历史成片只用于预览和上传选择，不会自动改写分镜。</span>}
          <small>{viewerInfo.width > 0 && viewerInfo.height > 0 ? `${viewerInfo.width} × ${viewerInfo.height} · ` : ''}{viewerInfo.ratioText}</small>
        </footer>
      </section>

      <aside className="batch-factory-media-pickstation-rail">
        {renderMergeRail()}
        {videos.map(renderVideoRail)}
      </aside>
    </div>

    <section
      ref={sheetRef}
      className={`batch-factory-media-bottom-sheet is-${sheetAnchor}${sheetDragging ? ' is-dragging' : ''}`}
      style={{ transform: `translateY(${currentSheetOffset}px)` }}
    >
      <div
        className="batch-factory-media-bottom-sheet-handle"
        onPointerDown={startSheetDrag}
        onPointerMove={moveSheetDrag}
        onPointerUp={endSheetDrag}
        onPointerCancel={endSheetDrag}
      ><i /></div>

      <div className="batch-factory-media-bottom-sheet-bar">
        <div className="batch-factory-media-bottom-sheet-ready">
          <span className={mergeReady ? 'is-ready' : ''}><PictureOutlined /></span>
          <div><b>{readyVideos.length} / {videos.length} 分镜已选好</b><small>{viewerKind === 'video' && viewerVideo ? `当前：${label(viewerVideo)} · ${videoState(viewerVideo).main ? batchFactoryStableMediaLabel('V', videoState(viewerVideo).main.id) : '未选主版本'}` : uploadSourceText}</small></div>
        </div>
        <div className="batch-factory-media-bottom-sheet-quick">
          {!followAudio ? <InputNumber min={0.5} max={4} step={0.1} value={mergeSpeed} onChange={value => onMergeSpeedChange?.(Number(value || 1))} addonAfter="x" /> : <span className="batch-factory-audio-quick-state">{audioBusy ? '读取配音…' : `配音 ${Number(audioDurationSeconds || 0).toFixed(2)}s · 自动 ${autoMergeRate > 0 ? autoMergeRate.toFixed(3) : '—'}x`}</span>}
          <Button size="small" onClick={toggleSheet}>{sheetAnchor === 'collapsed' ? '展开' : sheetAnchor === 'half' ? '全展开' : '收起'}</Button>
          <Tooltip title={mergeTooltip}><Button type="primary" loading={merging} disabled={!mergeAvailable || merging || !mergeReady || fixedSingleVideo && followAudio} onClick={runCurrentMerge}>合成当前书</Button></Tooltip>
          <Tooltip title="上传当前小说"><Button size="small" className="batch-factory-upload-network-button" onClick={onUpload} disabled={!mergedReady && !uploadVersion?.mediaUrl}>上传网络</Button></Tooltip>
        </div>
      </div>

      <div className="batch-factory-media-bottom-sheet-content">
        <div className="batch-factory-media-bottom-sheet-grid">
          <section>
            <h3>合成控制</h3>
            <div className="batch-factory-media-bottom-sheet-row"><span>本次倍率</span>{followAudio ? <b>{autoMergeRate > 0 ? `自动 · ${autoMergeRate.toFixed(3)}x` : '自动计算'}</b> : <InputNumber min={0.5} max={4} step={0.1} value={mergeSpeed} onChange={value => onMergeSpeedChange?.(Number(value || 1))} addonAfter="x" />}</div>
            <div className="batch-factory-media-bottom-sheet-row"><span>合并跟随配音</span><div className="batch-factory-follow-audio-control"><Switch checked={followAudio} disabled={fixedSingleVideo} loading={audioBusy} onChange={toggleFollowAudio} /><small>{fixedSingleVideo ? '固定开头模式不可用' : '可事后开启并自动读取当前书配音时长'}</small></div></div>
            {followAudio ? <><div className="batch-factory-media-bottom-sheet-row"><span>配音目标</span><div className="batch-factory-audio-duration-edit"><InputNumber min={0.1} step={0.01} value={audioDurationSeconds || undefined} onChange={value => setAudioDurationSeconds(Number(value || 0))} onBlur={persistManualAudioDuration} addonAfter="s" /><Button size="small" loading={audioBusy} onClick={() => measureMergeAudioDuration({ force: true })}>重新读取</Button></div></div><div className="batch-factory-media-bottom-sheet-row"><span>主视频总时长</span><b>{videoTotalSeconds > 0 ? `${videoTotalIsExact ? '' : '≈ '}${videoTotalSeconds.toFixed(2)}s` : '等待读取'}</b></div><div className="batch-factory-media-bottom-sheet-row"><span>自动倍率</span><b>{autoMergeRate > 0 ? `${autoMergeRate.toFixed(3)}x` : '—'}</b></div><div className="batch-factory-media-bottom-sheet-row"><span>预计成片</span><b>{estimatedFinalSeconds > 0 ? `${estimatedFinalSeconds.toFixed(2)}s` : '—'}</b></div></> : null}
            <div className="batch-factory-media-bottom-sheet-actions"><Tooltip title={mergeTooltip}><Button type="primary" loading={merging || audioBusy} disabled={!mergeAvailable || merging || !mergeReady || fixedSingleVideo && followAudio} onClick={runCurrentMerge}>{mergeJob?.status === 'succeeded' ? '重新合成' : '合成当前书'}</Button></Tooltip></div>
          </section>

          <section>
            <h3>上传与成片</h3>
            <div className="batch-factory-media-bottom-sheet-row"><span>当前上传来源</span><b>{uploadSourceText}</b></div>
            <Select value={pendingUploadKey || undefined} onChange={setPendingUploadKey} options={uploadOptions} placeholder="选择成片或分镜主版本" style={{ width: '100%' }} />
            <div className="batch-factory-media-bottom-sheet-actions">
              <Button onClick={applyPendingUploadSource} disabled={!pendingUploadKey || pendingUploadKey === uploadSourceKey() || Boolean(savingTaskId)} loading={Boolean(savingTaskId)}>设为上传来源</Button>
              <Tooltip title="上传当前小说"><Button className="batch-factory-upload-network-button" onClick={onUpload} disabled={!mergedReady && !uploadVersion?.mediaUrl}>上传网络</Button></Tooltip>
            </div>
          </section>

          <section className="is-wide">
            <h3>本次合成将使用</h3>
            <div className="batch-factory-media-bottom-sheet-snapshot">
              {videos.map((video, index) => {
                const main = videoState(video).main;
                return <button type="button" key={video.id} onClick={() => selectVideoPreview(video, main)}><b>分镜 {String(index + 1).padStart(2, '0')}</b><span>{main ? batchFactoryStableMediaLabel('V', main.id) : '未就绪'}</span></button>;
              })}
            </div>
          </section>
        </div>
        <p className="batch-factory-media-bottom-sheet-note">拖拽柄支持收起 / 半展开 / 全展开。超出边界时使用阻尼橡皮筋，松手根据手势速度选择吸附锚点。上传网络继续进入现有视频管理系统登录、组织、来源书城、解压数量与重复上传检查。</p>
      </div>
    </section>
  </div>;
}


function BatchLogs({ automationStatus, productionStatus, mergeStatus, error }) {
  const jobs = productionStatus?.jobs || [];
  const merges = mergeStatus?.jobs || [];
  const automationBooks = Array.isArray(automationStatus?.books) ? automationStatus.books : [];
  const automationCounts = automationStatus?.counts || {};
  const autoPublish = automationStatus?.autoPublish === true;
  return <><Alert type={error ? 'warning' : 'info'} showIcon message={error || '实时读取 V12 自动生产、视频与合并状态'} description={autoPublish ? '自动生产完成合成后会提交视频管理系统，并等待视频管理系统回读确认；未确认前不会显示上传成功。' : '刷新只回读状态，不会额外提交新任务。自动生产默认停在待上传，不会自动提交视频管理系统。'} />
    {automationStatus?.state && automationStatus.state !== 'idle' ? <Alert type={['needs_attention', 'unavailable'].includes(automationStatus.state) ? 'warning' : automationStatus.state === 'completed' ? 'success' : 'info'} showIcon message={automationStatus.state === 'unavailable' ? '自动生产状态暂不可读' : `自动生产 · ${automationStatus.state}`} description={automationStatus.state === 'unavailable' ? '不影响当前书的手动提取、配音、VIDEO 或上传操作。' : `就绪 ${Number(automationCounts.ready || 0)} / ${Number(automationCounts.total || automationBooks.length)}；执行中 ${Number(automationCounts.running || 0)}；失败 ${Number(automationCounts.failed || 0)}；阻塞 ${Number(automationCounts.blocked || 0)}`} /> : null}
    <div className="batch-factory-log-list">{automationBooks.map(book => <section key={`automation-${book.bookId}`}><strong>自动生产 · {book.title || book.bookId}</strong><span>{book.stage || 'pending'} · {book.status || 'pending'} · {book.updatedAt || '—'}</span><p>{book.message || '等待自动生产'}{book.error ? ` · ${book.error}` : ''}</p></section>)}{jobs.map(job => <section key={job.id}><strong>生成任务 · {job.status}</strong><span>{job.bookId || '批量任务'} · {job.updatedAt || job.createdAt || '—'}</span>{(job.tasks || []).map(task => { const durations = [['目标', task.targetDurationSeconds], ['请求', task.requestedDurationSeconds], ['实际', task.actualDurationSeconds]].filter(([, value]) => Number(value) > 0).map(([label, value]) => `${label} ${Number(value).toFixed(2).replace(/\.00$/, '')}s`).join(' · '); return <p key={task.id}>{task.videoId} · {task.status}{durations ? ` · ${durations}` : ''}{task.errorMessage ? ` · ${task.errorMessage}` : ''}</p>; })}</section>)}{merges.map(job => <section key={job.id}><strong>合并任务 · {job.status}</strong><span>{job.updatedAt || job.createdAt || '—'}</span><p>{job.outputUrl || job.errorMessage || '等待合并结果'}</p></section>)}{!automationBooks.length && !jobs.length && !merges.length ? <p>当前没有自动生产、视频或合并任务。</p> : null}</div>
  </>;
}

function localStartTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}

function UploadNetwork({ batch, books, selectedBookIds, productionStatus, mergeStatus, mode, onClose, onOpenPublish, onRefresh }) {
  const [account, setAccount] = useState(null);
  const [publishSession, setPublishSession] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploadingBookId, setUploadingBookId] = useState('');
  const [organizations, setOrganizations] = useState([]);
  const [organizationID, setOrganizationID] = useState('');
  const [organizationsError, setOrganizationsError] = useState('');
  const reupload = mode === 'reupload';
  const targetBooks = mode === 'all' ? books : books.filter(book => selectedBookIds.includes(book.id));
  const completedTasks = (productionStatus?.jobs || []).flatMap(job => job?.tasks || []);
  const hasBookUploadSource = book => {
    const source = book?.settingsState?.patch?.primaryUploadSource || {};
    if (source.kind === 'video') return completedTasks.some(task => task?.id === source.taskId && task?.videoId === source.videoId && task?.status === 'succeeded' && String(task?.mediaUrl || '').trim());
    return (mergeStatus?.jobs || []).some(job => job?.bookId === book?.id && job?.status === 'succeeded' && String(job?.outputUrl || '').trim());
  };
  const uploadMediaReady = targetBooks.length > 0 && targetBooks.every(hasBookUploadSource);
  const publishSettings = batch?.settingsState?.patch?.publishSettings || {};
  const hasSingleBookPublishOverride = targetBooks.some(book => Object.hasOwn(book?.settingsState?.patch || {}, 'publishSettings') || Object.hasOwn(book?.settingsState?.patch || {}, 'publishRewriteEnabled'));
  const materialReuseLabel = publishSettings.materialReuse === true ? '复用' : '不复用';
  const horizontalFlipLabel = publishSettings.horizontalFlip === true ? '翻转' : '不翻转';
  const missingPublishMapping = targetBooks.filter(book => {
    const settings = effectiveBookSettings(batch, book).publishSettings || {};
    return !completePublishMapping(settings, book);
  });
  const missingDecompression = targetBooks.filter(book => decompressionCountForUpload(batch, book) < 1);
  const alreadyUploaded = targetBooks.filter(book => isBookUploadedTo121(book));
  const requiresReupload = alreadyUploaded.length > 0 && !reupload;
  async function verify121Session() {
    const [config, environment] = await Promise.all([getWebSubmitConfig(), checkWebSubmitEnvironment()]);
    const settings = config?.settings || config?.config || {};
    setAccount(settings);
    const session = Boolean(environment?.ok && (environment?.checks || []).find(check => check.name === '121 后台登录会话')?.ok);
    if (!session) {
      setPublishSession({ environment, visible: null });
      return false;
    }
    const visible = await testWebSubmitVisible();
    setPublishSession({ environment, visible });
    return visible?.ok === true;
  }
  useEffect(() => {
    if (!mode) return undefined;
    setManifest(null);
    setResults([]);
    let active = true;
    Promise.all([verify121Session(), get121OrganizationOptions()]).then(([, response]) => {
      if (!active) return;
      setOrganizations(Array.isArray(response?.organizations) ? response.organizations : []);
    }).catch(error => { if (active) { setOrganizationsError(error?.message || '121 组织目录读取失败'); setPublishSession({ error: error?.message || '121 后台会话验证失败' }); } });
    return () => { active = false; };
  }, [mode]);
  useEffect(() => {
    if (!uploadingBookId || !onRefresh) return undefined;
    const timer = setInterval(() => { onRefresh().catch(() => {}); }, 1200);
    return () => clearInterval(timer);
  }, [uploadingBookId, onRefresh]);
  const publishSessionReady = Boolean(publishSession?.environment?.ok && publishSession?.visible?.ok);
  async function prepareUpload() {
    setBusy(true);
    try {
      if (!(await verify121Session())) throw new Error('请先在发布统一登录并验证 121 后台账号');
      if (missingPublishMapping.length) throw new Error(`当前书缺少来源书城，无法上传：${missingPublishMapping.map(book => book.title || book.bookId).join('、')}`);
      if (missingDecompression.length) throw new Error(`请添加解压，才能上传 AI 前贴视频：${missingDecompression.map(book => book.title || book.bookId).join('、')}`);
      if (requiresReupload) throw new Error(`当前书已上传，请使用重新上传：${alreadyUploaded.map(book => book.title || book.bookId).join('、')}`);
      setManifest(targetBooks.map(book => {
        const effectiveSettings = effectiveBookSettings(batch, book);
        return {
          id: book.id,
          title: book.title || book.bookId,
          txt: `${book.bookId}.txt`,
          mp4: `${book.bookId}.mp4`,
          videoType: effectiveSettings.publishSettings?.uploadVideoType === 'individual' ? '独立 VIDEO' : '最终合成视频',
          jieyaNum: decompressionCountForUpload(batch, book)
        };
      }));
    } catch (error) { message.error(error?.message || '生成上传清单失败'); } finally { setBusy(false); }
  }
  async function submitTo121() {
    setBusy(true);
    const submitted = [];
    try {
      for (const book of targetBooks) {
        try {
          setUploadingBookId(book.id);
          setResults(current => [...current.filter(item => item.id !== book.id), { id: book.id, title: book.title || book.bookId, pending: true, message: reupload ? '再次上传中：正在验证 121 会话、上传 AI 前贴与提交 TXT' : '正在上传：正在验证 121 会话、上传 AI 前贴与提交 TXT' }]);
          const result = await submitBookTo121(batch.id, book.id, { organization: organizationID, category: 'NEW_BOOK', startTime: localStartTime(), textModelId: effectiveBookSettings(batch, book).textModelId, reupload });
          submitted.push({ id: book.id, title: book.title || book.bookId, ok: true, result: resultData(result) });
          await onRefresh?.();
        } catch (error) {
          submitted.push({ id: book.id, title: book.title || book.bookId, ok: false, error: error?.message || '121 提交失败' });
          // A failed book is terminal for this click.  It prevents a mixed,
          // ambiguous batch result; the user can fix it then continue from it.
          break;
        }
      }
      setResults(submitted);
      const failed = submitted.find(item => !item.ok);
      if (failed) throw new Error(`${failed.title}：${failed.error}`);
      message.success(submitted.every(item => item.result?.status === 'confirmed') ? '已提交到 121，并已完成后台列表回读。' : '已提交到 121，正在等待后台列表回读。');
    } catch (error) { message.error(error?.message || '121 提交失败'); } finally { setUploadingBookId(''); setBusy(false); }
  }
  const liveUploadBook = books.find(book => book.id === uploadingBookId);
  const liveUploadProgress = uploadProgressForBook(liveUploadBook);
  return <Modal title={`上传网络 · ${mode === 'all' ? '提交全部' : reupload ? '重新上传' : '提交选中'}`} open={Boolean(mode)} onCancel={onClose} footer={null} width={700} destroyOnClose>
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Alert type="info" showIcon message={`已选择 ${targetBooks.length} 本小说`} description="每本书会作为一个独立的 121 包提交：`书号.txt` 为正文，`书号.mp4` 为自定义 AI 头部视频。提交后以 121 后台列表回读为准。" />
      <Alert type="info" showIcon message="本次上传素材设置" description={hasSingleBookPublishOverride ? '上传时按每本书的单书发布覆盖优先、批量统一设置兜底；生效值会随确认单冻结，不会修改 121 后台配置方案。' : `本次素材使用：${materialReuseLabel}；本次水平翻转：${horizontalFlipLabel}。这两个值会随确认单冻结，不会修改 121 后台配置方案。`} />
      {missingPublishMapping.length ? <Alert type="warning" showIcon message="存在缺少来源书城的书" description={missingPublishMapping.map(book => book.title || book.bookId).join('、')} /> : null}
      <Alert type="info" showIcon message="逐本识别发布信息" description="提交前会按每本书正文自动识别男女频、121 风格和标签；已有手动或已识别结果会直接复用。识别失败会终止当前书，不会改用批量默认值。" />
      {missingDecompression.length ? <Alert type="warning" showIcon message="请添加解压" description={`以下小说的解压数量为 0，不能附带 AI 前贴视频上传：${missingDecompression.map(book => book.title || book.bookId).join('、')}`} /> : null}
      {requiresReupload ? <Alert type="warning" showIcon message="存在已上传小说" description="普通上传不会重复提交已成功回读的小说。请从该书“查看资料”中选择重新上传。" /> : null}
      {!uploadMediaReady ? <Alert type="warning" showIcon message="存在尚未准备好的上传主视频" description="每本书需要先在片段库选择可用分镜主版本，或完成该书的最终合成成片；确认单不会提交空视频或未完成视频。" /> : null}
      <Tag color={publishSessionReady ? 'green' : 'default'}>{publishSessionReady ? `121 后台已登录：${account?.username || '当前账号'}` : '121 后台账号尚未登录或未验证'}</Tag>
      {publishSession?.error ? <Alert type="warning" showIcon message="121 后台会话验证失败" description={publishSession.error} /> : null}
      {!publishSessionReady ? <Button onClick={onOpenPublish}>前往发布统一登录并验证</Button> : null}
      {organizationsError ? <Alert type="warning" showIcon message="121 组织目录读取失败" description={organizationsError} /> : null}
      <Select value={organizationID || undefined} placeholder="请选择 121 组织归属" style={{ width: '100%' }} onChange={setOrganizationID} options={organizations.map(item => ({ value: item.id, label: item.level ? `${item.name}（${item.level}）` : item.name }))} disabled={!publishSessionReady || busy} />
      {!manifest ? <Button type="primary" onClick={prepareUpload} loading={busy} disabled={!targetBooks.length || !publishSessionReady || !uploadMediaReady || missingPublishMapping.length > 0 || missingDecompression.length > 0 || requiresReupload || !organizationID}>生成上传清单</Button> : null}
      {manifest ? <><Descriptions size="small" column={1} bordered items={manifest.map(item => ({ key: item.id, label: item.title, children: <span>{item.txt} + {item.mp4}（{item.videoType}，解压 {item.jieyaNum}）</span> }))} /><Alert type="warning" showIcon message={reupload ? '确认后将重新提交到 121' : '确认后将直接提交到 121'} description="提交到接口只表示对方已接收；本页会显示等待 121 后台列表回读，不能替代后台完成状态。" /><Button danger type="primary" onClick={submitTo121} loading={busy}>{reupload ? '确认重新上传到 121' : '确认并上传到 121'}</Button></> : null}
      {liveUploadBook ? <Alert type="info" showIcon message={`${liveUploadBook.title || liveUploadBook.bookId}：${liveUploadProgress?.message || '正在创建上传任务'}`} description={liveUploadProgress?.phase ? `当前阶段：${liveUploadProgress.phase}` : '正在等待服务端返回当前阶段。'} /> : null}
      {results.map(item => <Alert key={item.id} type={item.pending ? 'info' : item.ok ? 'info' : 'error'} showIcon message={`${item.title}：${item.pending ? item.message : item.ok ? (item.result?.status === 'confirmed' ? '已提交，121 已回读' : '已提交，等待 121 回读') : '提交失败'}`} description={item.pending ? '上传过程中的实际阶段会写入当前书状态；完成或失败后自动回读。' : item.ok ? `${item.result?.sourceTextFile || ''} + ${item.result?.aiHeadVideoFile || ''}${item.result?.receipt?.remote_record?.detail ? `；${item.result.receipt.remote_record.detail}` : ''}` : item.error} />)}
    </Space>
  </Modal>;
}

export function BatchFactoryNovelList({ batch, onBack, onBatchChanged }) {
  const [novelListOpen, setNovelListOpen] = useState(false);
  const [viewingBook, setViewingBook] = useState(null);
  const [stageSummaries, setStageSummaries] = useState({});
  const [metadataBook, setMetadataBook] = useState(null);
  const [metadataValue, setMetadataValue] = useState({});
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [assetBook, setAssetBook] = useState(null);
  const [configTarget, setConfigTarget] = useState(null);
  const [editingContentBook, setEditingContentBook] = useState(null);
  const [editingContentValue, setEditingContentValue] = useState('');
  const [editingContentMode, setEditingContentMode] = useState('original');
  const [viralCandidate, setViralCandidate] = useState('');
  const [derivedOpeningOptions, setDerivedOpeningOptions] = useState([]);
  const [derivedOpeningPresetId, setDerivedOpeningPresetId] = useState('');
  const [contentSaving, setContentSaving] = useState(false);
  const [rewritingFront, setRewritingFront] = useState(false);
	const [promptBook, setPromptBook] = useState(null);
	const [promptVideoId, setPromptVideoId] = useState('');
	const [mediaBook, setMediaBook] = useState(null);
	const [mediaVideoId, setMediaVideoId] = useState('');
	const [mediaStartTab, setMediaStartTab] = useState('clips');
	const [rowStoryboardSelection, setRowStoryboardSelection] = useState({});
  const [unifiedSettingsOpen, setUnifiedSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [automationStatus, setAutomationStatus] = useState({ state: 'idle', counts: { total: 0, ready: 0, running: 0, pending: 0, failed: 0, blocked: 0 } });
  const [automationBusy, setAutomationBusy] = useState('');
  const [automationStartOpen, setAutomationStartOpen] = useState(false);
  const [automationPresets, setAutomationPresets] = useState([]);
  const [automationPresetID, setAutomationPresetID] = useState('');
  const [automationRunMode, setAutomationRunMode] = useState('video_no_submit');
  const [automationScheduledAt, setAutomationScheduledAt] = useState('');
  const [productionStatus, setProductionStatus] = useState(null);
	const [activeProductionRequestID, setActiveProductionRequestID] = useState('');
  const [mergeStatus, setMergeStatus] = useState(null);
  const [mergeSpeed, setMergeSpeed] = useState(1);
  const [capabilities, setCapabilities] = useState({});
  const [configVersions, setConfigVersions] = useState([]);
  const [configVersionsError, setConfigVersionsError] = useState(null);
  const [actionBusy, setActionBusy] = useState('');
  const [uploadMode, setUploadMode] = useState('');
  const [selectedBookIds, setSelectedBookIds] = useState([]);
  const [platformNames, setPlatformNames] = useState({});
  const [columnWidths, setColumnWidths] = useState(null);
  const resizeActiveRef = useRef(false);
  const resizeStateRef = useRef(null);
  const books = Array.isArray(batch?.books) ? batch.books : [];
  useEffect(() => {
    if (!mediaBook) return;
    const refreshed = books.find(book => book.id === mediaBook.id);
    if (refreshed && refreshed.revision !== mediaBook.revision) setMediaBook(refreshed);
  }, [books, mediaBook]);
	const batchProgress = batchFactoryBatchProgress(books, { productionStatus, mergeStatus, stageSummaries });
	const progressSegments = [
		{ key: 'uploaded', label: '上传成功', count: batchProgress.uploaded },
		{ key: 'failed', label: '异常', count: batchProgress.failed },
		{ key: 'running', label: '执行中', count: batchProgress.running },
		{ key: 'awaiting-upload', label: '待上传', count: batchProgress.awaitingUpload },
		{ key: 'pending', label: '待开始', count: batchProgress.pending }
	].filter(segment => segment.count > 0).map(segment => ({ ...segment, percent: batchProgress.total ? (segment.count / batchProgress.total) * 100 : 0 }));
	const mediaVersionsByVideo = useMemo(() => completedMediaVersions(productionStatus), [productionStatus]);
  const mediaCounts = runtimeBatchMediaCounts(books, productionStatus, mergeStatus);
  const runCapability = capability(capabilities, 'director.run');
  const workingFrontCapability = capability(capabilities, 'working-front.viral');
  const compilerCapability = capability(capabilities, 'compiler.preview');
  const productionCapability = capability(capabilities, 'production.submit');
	const cancelCapability = capability(capabilities, 'production.cancel');
  const mergeCapability = capability(capabilities, 'merge.run');
  const automationState = String(automationStatus?.state || 'idle');
  const automationCounts = automationStatus?.counts || { total: 0, ready: 0, running: 0, pending: 0, failed: 0, blocked: 0 };
  const automationActive = automationState === 'running' || automationState === 'scheduled';

  async function refreshBatch() {
    await onBatchChanged?.();
  }
  async function fetchMissingBookSource(book) {
    if (!batch?.id || !book?.id || actionBusy || runtimeResolveBookProductionText(book)) return;
    setActionBusy(`source-${book.id}`);
    try {
      await fetchBookOriginal(batch.id, book.id);
      await refreshBatch();
      message.success('已获取并写入当前小说正文');
    } catch (error) {
      message.error(error?.message || '获取正文失败');
    } finally {
      setActionBusy('');
    }
  }
  async function ensureBookAudioDuration(book, { force = false, quiet = false } = {}) {
    const settings = effectiveBookSettings(batch, book);
    if (settings.fixedSingleVideo === true || settings.audioPlanningEnabled !== true) return Number(settings.audioDurationSeconds || 0);
    const input = batchFactoryBookAudioInput(book);
    const tts = await batchFactoryBookTts(settings);
    const fingerprint = batchFactoryAudioFingerprint(input, tts);
    const currentSeconds = Number(settings.audioDurationSeconds || 0);
    if (!force && currentSeconds > 0 && (settings.audioDurationManual === true || String(settings.audioDurationFingerprint || '') === fingerprint)) return currentSeconds;
    if (!quiet) message.info(`正在为《${book.title || book.bookId || '当前小说'}》读取真实配音时长…`);
    const measured = await generateBatchFactoryBookAudioMeasurement(book, settings);
    await saveBookOverrideWithRetry(batch.id, book.id, Number(book.revision || 0), { patch: { audioDurationSeconds: measured.durationSeconds, audioDurationFingerprint: measured.fingerprint, audioDurationManual: false } });
    return measured.durationSeconds;
  }
	async function compileBookH3Videos(book) {
		const latestResponse = await getBatch(batch.id);
		const latestBatch = latestResponse?.batch || latestResponse;
		const latestBook = (latestBatch?.books || []).find(item => item?.id === book.id);
		const director = latestBook?.directorRevision;
		const h3Document = director?.output?.h3_director || director?.output?.h3Director;
		if (!director?.id || !h3Document) return;
		const settings = effectiveBookSettings(latestBatch, latestBook);
		let priorTrace = null;
		try { priorTrace = await getH3Trace(latestBatch.id, latestBook.id); }
		catch (error) { if (Number(error?.status) !== 404 && !String(error?.message || '').includes('404')) throw error; }
		const hasManualPrompts = (priorTrace?.compilation?.compilation?.segments || []).some(segment => segment.compile_trace?.editable_copy_source === 'user_final_prompt');
		if (hasManualPrompts) {
			const confirmed = await new Promise(resolve => Modal.confirm({ title: '重新编译会替换手动编辑的分镜提示词', content: '历史提交记录保留。是否按当前配置重新生成完整提示词？', okText: '确认重新编译', cancelText: '保留手动提示词', onOk: () => resolve(true), onCancel: () => resolve(false) }));
			if (!confirmed) throw new Error('已保留手动提示词，当前配置尚未应用到最终分镜');
		}
		const tts = await batchFactoryBookTts(settings);
		const audioResult = await measureH3VideoLines({ directorId: director.id, document: h3Document, tts,
			previous: priorTrace?.timeline?.timeline?.audio_measurement,
			synthesize: textToSpeech, encode: blobToBase64,
			measure: payload => measureH3Audio(latestBatch.id, latestBook.id, payload) });
		const promptConfig = settings?.aiPromptConfig || {};
		const videoPreset = promptConfig.video || {};
		const videoPresetBody = String(videoPreset.body || '');
		const videoPromptTemplate = videoPresetBody.includes('{{storyboard}}') ? videoPresetBody : '';
		const constraints = promptConfig.constraints || {};
		const h3VisualRestriction = (constraints.selections || []).find(item => item?.constraintCategory === 'restriction');
		const maxSegmentSeconds = Number(settings.storyboardDurationLimit) === 15 ? 15 : 10;
		await compileH3Video(latestBatch.id, latestBook.id, {
			director_revision_id: director.id,
			audio_asset_id: audioResult?.audio_asset_id || audioResult?.audioMeasurement?.measurement?.asset_id || audioResult?.audio_measurement?.measurement?.asset_id,
			preset: {
				key: String(videoPreset.presetId || videoPreset.id || 'h3-video-normal'),
				revision: Math.max(1, Number(videoPreset.presetVersion || videoPreset.version || 1)),
				format: 'h3-structured-v1',
				max_segment_ms: maxSegmentSeconds * 1000,
				request_duration_mode: 'ceil-second',
				prompt_template: videoPromptTemplate,
				output_constraints: videoPromptTemplate ? '' : (videoPresetBody || '按结构化时间线输出当前 VIDEO，保持人物、动作、机位和场景连续性。')
			},
			visual_restriction_text: String(h3VisualRestriction?.body || ''),
			switches: {
				smart_unified: (constraints.selections || []).some(item => item?.constraintCategory === 'prefix' && item?.presetId === 'script-constraint-prefix-smart-unified'),
				base_setup: constraints.baseSetup?.enabled === true,
				visual_restriction: Boolean(h3VisualRestriction)
			},
			editable_copy_overrides: {},
			expected_compilation_id: priorTrace?.compilation?.id || '',
			allow_replace_manual_prompts: hasManualPrompts
		});
	}
	async function refreshAfterBookSettingsSaved() {
		const shouldRecompileH3 = ['constraints', 'video', 'media'].includes(configTarget?.region)
			&& Boolean(configTarget?.book?.directorRevision?.output?.h3_director || configTarget?.book?.directorRevision?.output?.h3Director);
		if (shouldRecompileH3) {
			try {
				message.info('设置已保存，正在复用现有导演数据重新编译最终 VIDEO Prompt…');
				await compileBookH3Videos(configTarget.book);
				message.success('设置已生效，最终 VIDEO Prompt 已重新编译。');
			} catch (error) {
				message.error(error?.message ? `设置已保存，但 H3 重编译失败：${error.message}` : '设置已保存，但 H3 重编译失败');
			}
		}
		await refreshBatch();
	}
  async function resetBookAudioMeasurement(book, expectedRevision = book?.revision) {
    return saveBookOverrideWithRetry(batch.id, book.id, Number(expectedRevision || 0), { patch: { audioDurationSeconds: 0, audioDurationFingerprint: '', audioDurationManual: false } });
  }
  async function loadStageSummaries() {
    const results = await Promise.allSettled(books.map(book => getBookStageSummary(batch.id, book.id)));
    setStageSummaries(Object.fromEntries(results.flatMap((result, index) => result.status === 'fulfilled' ? [[books[index].id, resultData(result.value, 'summary')]] : [])));
  }
  async function loadRuntimeStatus({ quiet = false, runtimeCapabilities = capabilities } = {}) {
    if (!batch?.id) return;
    setLogsLoading(true);
    try {
      const [production, merge] = await Promise.all([
        getProductionStatus(batch.id),
        getMergeStatus(batch.id)
      ]);
      setProductionStatus(production);
      setMergeStatus(merge);
      await loadStageSummaries();
      setLogsError('');
    } catch (error) {
      const endpoint = String(error?.source || '').trim();
      const status = Number.isInteger(error?.status) ? `HTTP ${error.status}` : '';
      const text = [error?.message || '读取任务状态失败', status, endpoint ? `状态接口：${endpoint}` : ''].filter(Boolean).join(' · ');
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
    if (!batch?.id) return undefined;
    let active = true;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await getBatchAutomationStatus(batch.id);
        if (!active) return;
        const next = resultData(result, 'automation');
        setAutomationStatus(next || { state: 'idle', counts: { total: 0, ready: 0, running: 0, pending: 0, failed: 0, blocked: 0 } });
        if (next?.state === 'running') await onBatchChanged?.();
      } catch (error) {
        if (active && Number(error?.status || 0) !== 404) console.error('[batch-factory-automation] status read failed', error);
      } finally { polling = false; }
    };
    void poll();
    const timer = setInterval(poll, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [batch?.id]);
  useEffect(() => {
    let active = true;
    getWorkshopPlatforms({ suppressGlobalError: true }).then(result => {
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
  }, [batch?.id, assetBook?.id, books]);
  useEffect(() => {
    if (!promptBook) return;
    const refreshed = books.find(book => book.id === promptBook.id);
    if (refreshed && refreshed !== promptBook) setPromptBook(refreshed);
  }, [batch?.id, promptBook?.id, books]);
  useEffect(() => {
    if (!configTarget?.book) return;
    const refreshed = books.find(book => book.id === configTarget.book.id);
    if (refreshed && refreshed !== configTarget.book) setConfigTarget(current => current ? { ...current, book: refreshed } : current);
  }, [batch?.id, configTarget?.book?.id, books]);
  const hasActiveProduction = (productionStatus?.jobs || []).some(job => (job?.tasks || []).some(task => ['queued', 'running'].includes(String(task?.status || '').toLowerCase())));
  useEffect(() => {
    if (!batch?.id || !(viewingBook || mediaBook || promptBook || hasActiveProduction)) return undefined;
    const timer = setInterval(() => { loadRuntimeStatus({ quiet: true }); }, hasActiveProduction ? 2000 : 5000);
    return () => clearInterval(timer);
  }, [batch?.id, viewingBook?.id, mediaBook?.id, promptBook?.id, hasActiveProduction]);

  async function openContentEditor(book) {
    setEditingContentBook(book);
    setEditingContentValue(runtimeResolveBookProductionText(book));
    setEditingContentMode(batchFactoryContentMode(book));
    setViralCandidate('');
    setDerivedOpeningOptions([]);
    setDerivedOpeningPresetId('');
    const [draftRequest, catalogRequest] = await Promise.allSettled([
      getDraft({ key: `working-front-candidate:${book.id}`, kind: 'working-front-viral-candidate', scope: batch.id }, { suppressGlobalError: true }),
      listSystemPresetCatalog('batch-factory')
    ]);
    if (draftRequest.status === 'fulfilled') {
      setViralCandidate(String(resultData(draftRequest.value, 'draft')?.content || ''));
    } else if (draftRequest.reason?.status && draftRequest.reason.status !== 404) {
      message.error(draftRequest.reason?.message || '读取爆款候选失败');
    }
    if (catalogRequest.status !== 'fulfilled') {
      message.error(catalogRequest.reason?.message || '读取衍生开篇提示词失败');
      return;
    }
    const allowedSlots = new Set(['batch.hook-adaptation', 'batch.original-director', 'batch.viral-director']);
    const options = (Array.isArray(catalogRequest.value?.catalog) ? catalogRequest.value.catalog : [])
      .filter(item => allowedSlots.has(String(item?.slot || '')))
      .map(item => ({ value: item.id, label: `${item.name || item.id} · v${item.version || 1}` }));
    setDerivedOpeningOptions(options);
    const inheritedId = String(batch?.settingsState?.patch?.aiPromptConfig?.derivedOpening?.presetId || '');
    setDerivedOpeningPresetId(options.some(option => option.value === inheritedId) ? inheritedId : (options[0]?.value || ''));
  }
  async function saveWorkingContent() {
    if (!editingContentBook) return;
    setContentSaving(true);
    try {
      await saveDraft({ key: `working-front:${editingContentBook.id}`, kind: 'working-front-content', scope: batch.id, content: editingContentValue.trim() });
      const metadataResult = await updateBookMetadata(batch.id, editingContentBook.id, { metadata: { ...(editingContentBook.sourceMetadata || {}), productionContentMode: editingContentMode }, expectedRevision: Number(editingContentBook.revision || 0) });
      const updatedBook = resultData(metadataResult, 'book') || metadataResult;
      await resetBookAudioMeasurement(editingContentBook, Number(updatedBook?.revision || editingContentBook.revision || 0));
      await refreshBatch();
      setEditingContentBook(null);
      message.success('当前小说的生产内容已保存；原文不会被覆盖。');
    } catch (error) { message.error(error?.message || '保存生产内容失败'); } finally { setContentSaving(false); }
  }
  async function createViralCandidate() {
    if (!editingContentBook || rewritingFront) return;
    setRewritingFront(true);
    try {
      const result = await rewriteWorkingFront(batch.id, editingContentBook.id, editingContentValue, {
        textModelId: effectiveBookSettings(batch, editingContentBook).textModelId,
        promptPresetId: derivedOpeningPresetId
      });
      const candidate = String(resultData(result, 'candidate') || '').trim();
      setViralCandidate(candidate);
      message.success('爆款候选已生成，请确认后再替换当前生产内容。');
    } catch (error) { message.error(error?.message || '生成爆款候选失败'); } finally { setRewritingFront(false); }
  }
  async function cancelViralCandidate() {
    if (!editingContentBook) return;
    try {
      await saveDraft({ key: `working-front-candidate:${editingContentBook.id}`, kind: 'working-front-viral-candidate', scope: batch.id, content: '' });
      setViralCandidate('');
      message.info('已取消本次爆款候选，当前生产内容未改动。');
    } catch (error) { message.error(error?.message || '取消爆款候选失败'); }
  }
  async function refreshAssetPresetSnapshot(book) {
    const aiPromptConfig = book?.settingsState?.patch?.aiPromptConfig;
    if (!aiPromptConfig || typeof aiPromptConfig !== 'object') return;
    // Older local builds persisted only preset metadata. Re-save through the
    // current Node bridge so the selected published body is frozen before the
    // asset-only stage asks the text provider to extract anything.
    await saveBookOverride(batch.id, book.id, {
      patch: { aiPromptConfig },
      expectedRevision: Number(book.revision || 0)
    });
    await refreshBatch();
  }
  async function runBookStageAction(book, stage, mode = 'missing', videoId = '', textModelId = '') {
    if (!batch?.id || !book?.id || actionBusy) return;
    setActionBusy(stageActionKey(stage, book.id));
    try {
      const settings = effectiveBookSettings(batch, book);
      if (stage === 'director' && settings.audioPlanningEnabled === true) {
        if (settings.fixedSingleVideo === true) throw new Error('固定开头只生产 VIDEO01，请先关闭固定开头后再使用分镜规划跟随配音。');
        await ensureBookAudioDuration(book);
      }
      await runBookStage(batch.id, book.id, stage, {
        mode,
		h3: true,
        videoId,
        textModelId: textModelId || settings.textModelId,
        ...(stage === 'video' ? { provider: videoProviderForModel(settings.videoModelId, settings.videoProvider) } : {}),
        requestId: requestID(`bf11-${stage}-${mode}`)
      });
		if (stage === 'director') await compileBookH3Videos(book);
      await Promise.all([refreshBatch(), loadRuntimeStatus({ quiet: true })]);
      const labels = { assets: mode === 'force' ? '已重新生成资产；分镜和 VIDEO 未改动' : '已生成资产', director: mode === 'force' ? '已重新生成文案' : '已生成文案', image: mode === 'force' ? '已重新生成图片' : '已生成图片', video: mode === 'force' ? '已创建新的视频候选版本' : '已提交视频生成' };
      message.success(labels[stage] || '当前小说阶段已提交。');
    } catch (error) {
      // A provider can reject a request synchronously (quota, moderation, or
      // invalid input).  Reload the persisted stage run as well as the book so
      // the error is visible in the card and task timeline immediately.
      // End the visible action before any best-effort readback.  A slow status
      // endpoint must never leave a rejected upstream request spinning.
      setActionBusy('');
      message.error(error?.message || '当前小说阶段执行失败');
      void Promise.all([refreshBatch(), loadRuntimeStatus({ quiet: true })]).catch(() => {});
    } finally { setActionBusy(''); }
  }
  async function retryLastFailedStage(book, videoId = '', textModelId = '') {
    if (!batch?.id || !book?.id || actionBusy) return;
    setActionBusy(stageActionKey('retry', book.id));
    try {
      const summary = resultData(await getBookStageSummary(batch.id, book.id), 'summary');
      if (!summary?.lastFailed) {
        message.info('当前小说没有可重试的失败步骤。');
        await loadStageSummaries();
        return;
      }
      const settings = effectiveBookSettings(batch, book);
      if (summary.lastFailed?.stage === 'director' && settings.audioPlanningEnabled === true) await ensureBookAudioDuration(book);
      await retryBookStage(batch.id, book.id, {
		h3: true,
        videoId,
        textModelId: textModelId || settings.textModelId,
        ...(summary.lastFailed?.stage === 'video' ? { provider: videoProviderForModel(settings.videoModelId, settings.videoProvider) } : {}),
        requestId: requestID('bf11-book-retry')
      });
		if (summary.lastFailed?.stage === 'director') await compileBookH3Videos(book);
      await Promise.all([refreshBatch(), loadRuntimeStatus({ quiet: true })]);
      message.success('已识别并重跑该书最后失败的步骤。');
    } catch (error) {
      setActionBusy('');
      message.error(error?.message || '当前小说没有可重试的失败步骤');
      void Promise.all([refreshBatch(), loadRuntimeStatus({ quiet: true })]).catch(() => {});
    } finally { setActionBusy(''); }
  }
  async function runAi(scope, textModelId = '') {
    if (!batch?.id || actionBusy) return;
    if (scope?.id) { await runBookStageAction(scope, 'director', 'missing', '', textModelId); return; }
    setActionBusy('director');
    try {
      const audioBooks = books.filter(book => { const settings = effectiveBookSettings(batch, book); return settings.audioPlanningEnabled === true && settings.fixedSingleVideo !== true; });
      if (audioBooks.length) message.info(`正在逐本读取 ${audioBooks.length} 本小说的真实配音时长…`);
      for (const book of audioBooks) await ensureBookAudioDuration(book, { quiet: true });
      await runBatchDirector(batch.id, { textModelId: textModelId || batch?.settingsState?.patch?.textModelId });
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
      const settings = book ? effectiveBookSettings(batch, book) : (batch?.settingsState?.patch || {});
      const provider = videoProviderForModel(settings.videoModelId, settings.videoProvider);
      if (book) await runBookStage(batch.id, book.id, 'video', { mode: 'missing', provider, requestId: operationRequestID });
      else await submitBatchProduction(batch.id, operationRequestID, provider);
      setActiveProductionRequestID(operationRequestID);
      await Promise.all([refreshBatch(), loadRuntimeStatus({ quiet: true })]);
      message.success(book ? '当前小说的视频任务已提交。' : '批量视频任务已提交。');
    } catch (error) { message.error(error?.message || '提交视频任务失败'); } finally { setActionBusy(''); }
  }
  function mergePayload(prefix, book = null, speed = 1, overrides = {}) {
    const settings = book ? effectiveBookSettings(batch, book) : (batch?.settingsState?.patch || {});
    const followAudio = settings.fixedSingleVideo === true ? false : (Object.hasOwn(overrides, 'followAudio') ? overrides.followAudio === true : settings.audioMergeEnabled === true);
    const audioDurationSeconds = Object.hasOwn(overrides, 'audioDurationSeconds')
      ? Number(overrides.audioDurationSeconds || 0)
      : Number(settings.audioDurationSeconds || 0);
    return {
      requestId: requestID(prefix),
      timingMode: followAudio ? 'audio' : 'speed',
      speed: followAudio ? 0 : Number(overrides.speed ?? speed ?? 1),
      audioDurationSeconds: followAudio ? audioDurationSeconds : 0
    };
  }
  async function runMerge() {
    if (!batch?.id || actionBusy) return;
    setActionBusy('merge');
    try {
      await submitBatchMerge(batch.id, mergePayload('bf11-merge'));
      await loadRuntimeStatus({ quiet: true });
      message.success('批量合并任务已提交。');
    } catch (error) { message.error(error?.message || '提交批量合并失败'); } finally { setActionBusy(''); }
  }
  async function runBookMerge(book, overrides = {}) {
    if (!batch?.id || !book?.id || actionBusy) return;
    setActionBusy(`merge-${book.id}`);
    try {
      await submitBookMerge(batch.id, book.id, mergePayload('bf11-book-merge', book, Number(overrides.speed ?? mergeSpeed ?? 1), overrides));
      await loadRuntimeStatus({ quiet: true });
      message.success('当前小说最终合成任务已提交。');
    } catch (error) { message.error(error?.message || '提交当前小说合成失败'); } finally { setActionBusy(''); }
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
  async function loadAutomationPresets() {
    const result = await listAutomationPresets();
    const values = resultData(result, 'presets') || [];
    setAutomationPresets(values);
    return values;
  }
  async function openAutomationStart() {
    try {
      const values = await loadAutomationPresets();
      setAutomationPresetID(current => current || values[0]?.id || '');
      setAutomationStartOpen(true);
    } catch (error) { message.error(error?.message || '读取自动化预设失败'); }
  }
  async function runAutomationAction(key) {
    if (!batch?.id || automationBusy) return;
    if (key === 'start' && !automationPresetID) { message.warning('请先选择自动化预设'); return; }
    setAutomationBusy(key);
    try {
      let result;
      if (key === 'start') result = await startBatchAutomation(batch.id, { presetId: automationPresetID, runMode: automationRunMode, scheduledAt: automationScheduledAt || undefined });
      else if (key === 'pause') result = await pauseBatchAutomation(batch.id);
      else if (key === 'resume') result = await resumeBatchAutomation(batch.id);
      else if (key === 'retry') result = await retryBatchAutomation(batch.id);
      else if (key === 'cancel') result = await cancelBatchAutomation(batch.id);
      const next = resultData(result, 'automation');
      setAutomationStatus(next || automationStatus);
      if (key === 'start') { setAutomationStartOpen(false); message.success(automationScheduledAt ? '已创建定时自动化任务。' : '已启动自动化任务。'); }
      else if (key === 'pause') message.info('已暂停自动化；已提交给模型或合并器的在途任务不会被强制删除。');
      else if (key === 'resume') message.success('已继续自动化。');
      else if (key === 'retry') message.success('已重置失败或阻塞小说，并从缺失阶段继续。');
      else if (key === 'cancel') message.info('已停止自动化编排；已在途的供应商任务仍会保留。');
      await Promise.allSettled([refreshBatch(), loadRuntimeStatus({ quiet: true })]);
    } catch (error) {
      message.error(error?.message || '批量工厂自动化操作失败');
    } finally { setAutomationBusy(''); }
  }

  function openMetadataEditor(book) {
    setMetadataBook(book);
    setMetadataValue({ ...(book?.sourceMetadata || {}) });
  }
  async function classifyBookMetadata(book, force = true) {
    if (!batch?.id || !book?.id || actionBusy) return;
    setActionBusy(`classify-${book.id}`);
    try {
      const result = await classifyBookPublishMetadata(batch.id, book.id, {
        textModelId: effectiveBookSettings(batch, book).textModelId,
        force
      });
      const nextBook = resultData(result, 'book');
      await refreshBatch();
      if (nextBook?.id === viewingBook?.id) setViewingBook(nextBook);
      message.success(resultData(result, 'reused') ? '已复用当前书的发布分类信息。' : '已识别当前书的男女频、风格和标签。');
    } catch (error) { message.error(error?.message || 'AI 判断发布信息失败'); } finally { setActionBusy(''); }
  }
  async function saveBookMetadata() {
    if (!batch?.id || !metadataBook || metadataSaving) return;
    setMetadataSaving(true);
    try {
      await updateBookMetadata(batch.id, metadataBook.id, { metadata: metadataValue, expectedRevision: Number(metadataBook.revision || 0) });
      await refreshBatch();
      setViewingBook(null);
      setMetadataBook(null);
      message.success('小说列表元数据已保存。');
    } catch (error) { message.error(error?.message || '保存小说元数据失败'); } finally { setMetadataSaving(false); }
  }
  async function saveSettings(patch) {
    const normalized = { ...patch, audioDurationSeconds: 0, ...(patch.fixedSingleVideo === true ? { audioPlanningEnabled: false, audioMergeEnabled: false } : {}) };
    try {
      await saveBatchSettings(batch.id, { patch: normalized, expectedRevision: Number(batch?.settingsState?.revision || 0) }, { suppressGlobalError: true });
    } catch (error) {
      if (Number(error?.status) !== 409) {
        message.error(error?.message || '应用统一引擎配置失败');
        return false;
      }
      try {
        const latestResult = await getBatch(batch.id);
        const latestBatch = resultData(latestResult, 'batch');
        if (!sameSettingsPatch(latestBatch?.settingsState?.patch, batch?.settingsState?.patch)) {
          await refreshBatch();
          message.warning('配置已更新，已刷新当前统一配置；请核对后重新保存。');
          return false;
        }
        await saveBatchSettings(batch.id, {
          patch: normalized,
          expectedRevision: Number(latestBatch?.settingsState?.revision || 0)
        }, { suppressGlobalError: true });
      } catch (retryError) {
        message.error(retryError?.message || '应用统一引擎配置失败');
        return false;
      }
    }
    try {
      await refreshBatch();
      message.success(`统一配置已应用到当前批量；已有单书覆盖保持不变。`);
      return true;
    } catch (error) { message.error(error?.message || '统一配置已保存，但刷新工作台失败'); return false; }
  }
  async function previewChangeImpact(patch) {
    try { const impact = await getChangeImpact(batch.id, { patch, expectedRevision: Number(batch?.settingsState?.revision || 0) }); return { ok: true, impact: resultData(impact, 'impact') }; } catch (error) { return { ok: false, message: error?.message || '无法读取配置影响' }; }
  }
  const batchMenuItems = [
    { key: 'production', label: '批量生成视频', disabled: !productionCapability.available, title: productionCapability.reason },
    { key: 'merge', label: '合并当前主 VIDEO', disabled: !mergeCapability.available, title: mergeCapability.reason }
  ];
  const automationStartBlocked = !books.length;
  const automationMenuItems = [
    { key: 'start', label: '开始定时', disabled: automationActive || automationStartBlocked },
    { key: 'pause', label: '暂停自动化', disabled: !automationActive },
    { key: 'resume', label: '继续自动化', disabled: automationState !== 'paused' },
    { key: 'retry', label: `重试失败小说（${Number(automationCounts.failed || 0) + Number(automationCounts.blocked || 0)}）`, disabled: !(Number(automationCounts.failed || 0) + Number(automationCounts.blocked || 0)) },
    { key: 'cancel', label: '停止自动化编排', danger: true, disabled: ['idle', 'completed', 'cancelled'].includes(automationState) }
  ];
  const automationLabel = automationState === 'running'
    ? `自动生产 ${automationCounts.ready || 0}/${automationCounts.total || books.length}`
    : automationState === 'scheduled'
      ? '自动生产 · 已定时'
      : automationState === 'paused'
        ? '自动生产 · 已暂停'
        : automationState === 'needs_attention'
          ? '自动生产 · 待处理'
          : automationState === 'unavailable'
            ? '自动生产 · 状态暂不可读'
          : automationState === 'completed'
            ? '自动生产 · 已就绪'
            : '自动生产';
  const uploadMenuItems = [{ key: 'selected', label: `提交选中（${selectedBookIds.length}）`, disabled: !selectedBookIds.length }, { key: 'all', label: '提交全部' }];

  function moveColumnResize(event) {
    const resize = resizeStateRef.current;
    if (!resize || !Number.isFinite(event.clientX)) return;
    const nextWidths = resize.startingWidths.map((width, columnIndex) => columnIndex === resize.index ? Math.max(BATCH_FACTORY_TABLE_COLUMNS[resize.index].minWidth, Math.min(780, resize.startWidth + event.clientX - resize.startX)) : width);
    setColumnWidths(nextWidths);
  }

  function finishColumnResize() {
    if (!resizeActiveRef.current && !resizeStateRef.current) return;
    resizeActiveRef.current = false;
    resizeStateRef.current = null;
    document.body.classList.remove('batch-factory-column-resizing');
    document.removeEventListener('mousemove', moveColumnResize);
    document.removeEventListener('mouseup', finishColumnResize);
    document.removeEventListener('pointermove', moveColumnResize);
    document.removeEventListener('pointerup', finishColumnResize);
  }

  function startColumnResize(event, index, preventDefault = true) {
    if (resizeActiveRef.current) return;
    const header = event.currentTarget.closest('.shuihuo-workbench-head');
    const measured = header ? (getComputedStyle(header).gridTemplateColumns.match(/[\d.]+px/g)?.map(Number.parseFloat) || []) : [];
    const savedWidths = Array.isArray(columnWidths) && columnWidths.length === BATCH_FACTORY_TABLE_COLUMNS.length && columnWidths.every(Number.isFinite) ? columnWidths : null;
    const startingWidths = savedWidths || measured;
    if (startingWidths.length !== BATCH_FACTORY_TABLE_COLUMNS.length || !startingWidths.every(Number.isFinite)) return;
    if (preventDefault) {
      event.preventDefault();
      event.stopPropagation();
    }
    resizeActiveRef.current = true;
    resizeStateRef.current = { index, startX: event.clientX, startWidth: startingWidths[index], startingWidths };
    if (Number.isInteger(event.pointerId)) event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.classList.add('batch-factory-column-resizing');
    document.addEventListener('mousemove', moveColumnResize);
    document.addEventListener('mouseup', finishColumnResize, { once: true });
    document.addEventListener('pointermove', moveColumnResize);
    document.addEventListener('pointerup', finishColumnResize, { once: true });
  }

  return <section className="shuihuo-workbench batch-factory-workbench">
    <header className="shuihuo-workbench-header">
      <div className="shuihuo-workbench-heading"><button className="shuihuo-back-link" type="button" title="返回个人作品" aria-label="返回个人作品" onClick={onBack}><ArrowLeftOutlined /></button><strong>批量工厂 V12 · {batch?.title || '未命名批量'}</strong><div className="shuihuo-workbench-progress" aria-label={`完成率 ${batchProgress.completionPercent}%`}><div className="shuihuo-workbench-progress-track batch-factory-completion-track">{progressSegments.map(segment => <i key={segment.key} className={`is-${segment.key}`} title={`${segment.label} ${segment.count} 本`} style={{ width: `${segment.percent}%` }} />)}</div><span>{batchProgress.completionPercent}%</span></div></div>
      <div className="shuihuo-workbench-toolbar" role="toolbar" aria-label="批量工厂工具栏">
        <Button type="text" icon={<BarsOutlined />} onClick={() => setNovelListOpen(true)}>小说列表</Button>
        <Button type="text" icon={<SettingOutlined />} onClick={() => setUnifiedSettingsOpen(true)}>统一配置</Button>
        <Dropdown menu={{ items: automationMenuItems, onClick: ({ key }) => key === 'start' ? openAutomationStart() : runAutomationAction(key) }}><Button type="text" loading={Boolean(automationBusy)} disabled={automationState === 'idle' && automationStartBlocked}>{automationLabel}</Button></Dropdown>
        <Dropdown menu={{ items: batchMenuItems, onClick: ({ key }) => key === 'production' ? runProduction() : runMerge() }}><Button className="shuihuo-batch-button" type="text" icon={<PictureOutlined />} loading={actionBusy === 'production' || actionBusy === 'merge'}>批量操作</Button></Dropdown>
		<Tooltip title={cancelCapability.available ? '取消可取消的本地执行器任务；其它供应商保持在途状态。' : cancelCapability.reason}><Button className="shuihuo-cancel-button" type="text" loading={actionBusy === 'cancel'} disabled={!cancelCapability.available || Boolean(actionBusy)} onClick={cancelProduction}>取消操作</Button></Tooltip>
      </div>
      <div className="shuihuo-workbench-export"><Button type="text" icon={<BarsOutlined />} onClick={() => { setLogsOpen(true); loadRuntimeStatus(); }} loading={logsLoading}>任务/日志</Button><Dropdown menu={{ items: uploadMenuItems, onClick: ({ key }) => setUploadMode(key) }}><Button icon={<UploadOutlined />}>上传网络</Button></Dropdown></div>
      <div className="shuihuo-project-stats"><span><b>{books.length}</b> 本小说</span><span className="is-uploaded"><b>{batchProgress.uploaded}</b> 上传成功</span>{batchProgress.failed ? <span className="is-failed"><b>{batchProgress.failed}</b> 异常</span> : null}{batchProgress.running ? <span className="is-running"><b>{batchProgress.running}</b> 执行中</span> : null}{batchProgress.awaitingUpload ? <span className="is-awaiting-upload"><b>{batchProgress.awaitingUpload}</b> 待上传</span> : null}{batchProgress.pending ? <span><b>{batchProgress.pending}</b> 待开始</span> : null}{automationState !== 'idle' ? <span className={automationState === 'needs_attention' ? 'is-failed' : automationActive ? 'is-running' : 'is-awaiting-upload'}><b>{automationCounts.ready || 0}/{automationCounts.total || books.length}</b> 自动就绪</span> : null}<span><b>{mediaCounts.storyboards}</b> 分镜</span>{productionCapability.available ? <span className="is-running"><b>{mediaCounts.playable}</b> 可播放</span> : <span className="is-disabled">视频模块未启用</span>}{mergeCapability.available ? <span className="is-uploaded"><b>{mediaCounts.merges}</b> 成片</span> : <span className="is-disabled">合并模块未启用</span>}</div>
    </header>
    <div className="shuihuo-workbench-table batch-factory-workbench-table" role="table" aria-label="批量工厂小说生产表">
      <div className="shuihuo-workbench-head" role="row" style={columnWidths ? { gridTemplateColumns: columnWidths.map(width => `${width}px`).join(' ') } : undefined}>{BATCH_FACTORY_TABLE_COLUMNS.map((column, index) => <div role="columnheader" key={column.label}>{index === 0 ? <><Checkbox checked={books.length > 0 && selectedBookIds.length === books.length} indeterminate={selectedBookIds.length > 0 && selectedBookIds.length < books.length} onChange={event => setSelectedBookIds(event.target.checked ? books.map(book => book.id) : [])} aria-label="全选小说" /><span>序号</span></> : column.label}{index > 0 ? <button type="button" draggable className="batch-factory-column-resize-handle" onPointerDown={event => startColumnResize(event, index)} onMouseDown={event => startColumnResize(event, index)} onDragStart={event => startColumnResize(event, index, false)} onDrag={moveColumnResize} onDragEnd={finishColumnResize} aria-label={`调整${column.label}列宽`} title="拖动分隔线调整列宽"><i aria-hidden="true" /></button> : null}</div>)}</div>
      {books.map((book, index) => {
        const stageSummary = stageSummaries[book.id];
        const state = batchFactoryBookState(book, { productionStatus, mergeStatus, stageSummary });
        const rangeLines = contentRangeLinesForBook(book);
        const previewText = runtimeResolveBookProductionText(book);
        const videos = book.videos || [];
        return <article className="shuihuo-workbench-row batch-factory-book-row" key={book.id} role="row" style={columnWidths ? { gridTemplateColumns: columnWidths.map(width => `${width}px`).join(' ') } : undefined}>
          <div className="shuihuo-workbench-cell shuihuo-order-cell"><Checkbox checked={selectedBookIds.includes(book.id)} onChange={event => setSelectedBookIds(current => event.target.checked ? [...new Set([...current, book.id])] : current.filter(id => id !== book.id))} aria-label={`选择 ${book.title || `小说 ${index + 1}`}`} /><strong>{index + 1}</strong></div>
          <div className="shuihuo-workbench-cell batch-factory-book-content" role="button" tabIndex={0} title="点击编辑当前小说的生产内容" onClick={() => openContentEditor(book)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openContentEditor(book); } }}><strong>{book.title || `小说 ${index + 1}`}</strong><span>bookId：{book.bookId || '—'} · 书城：{bookPlatformName(book, platformNames)} · 生产前 {rangeLines} 行</span><p>{previewText || '原文尚未获取'}</p></div>
          <div className="shuihuo-workbench-cell batch-factory-book-config-cell"><div className="batch-factory-book-config-regions">{batchFactoryWorkbenchConfigRegions(book).map(region => { const status = region.combinedStatus || bookConfigRegionStatus(book, region.key); const detail = region.key === 'assets' ? bookAssetSummary(book) : status.label; return <button type="button" key={region.key} className={`batch-factory-book-config-region is-${status.tone}`} onClick={() => region.key === 'assets' ? setAssetBook(book) : setConfigTarget({ book, region: region.key })}><b>{region.label}</b><small>{detail}</small></button>; })}</div></div>
		  <div className="shuihuo-workbench-cell shuihuo-preset-cell batch-factory-book-preset-cell"><InlineStoryboardAssets book={book} batchId={batch?.id} selectedVideoId={rowStoryboardSelection[book.id] || videos[0]?.id || ''} onSelectedVideoChange={videoId => setRowStoryboardSelection(current => ({ ...current, [book.id]: videoId }))} onManage={() => setAssetBook(book)} onSaved={refreshBatch} /></div>
		  <InlineBookPrompts batch={batch} book={book} batchId={batch?.id} settingsRevision={batch?.settingsState?.revision} selectedVideoId={rowStoryboardSelection[book.id] || videos[0]?.id || ''} onSelectedVideoChange={videoId => setRowStoryboardSelection(current => ({ ...current, [book.id]: videoId }))} onManage={videoId => { setPromptVideoId(videoId || ''); setPromptBook(book); }} />
		  <div className="shuihuo-workbench-cell shuihuo-library-cell batch-factory-book-library-cell"><InlineMediaLibrary book={book} versionsByVideo={mediaVersionsByVideo} productionStatus={productionStatus} mergeJob={latestBookMerge(mergeStatus, book.id)} aspectRatio={effectiveBookSettings(batch, book).aspectRatio} selectedVideoId={rowStoryboardSelection[book.id] || videos[0]?.id || ''} onSelectedVideoChange={videoId => setRowStoryboardSelection(current => ({ ...current, [book.id]: videoId }))} onManage={videoId => { setMediaVideoId(videoId || ''); setMediaStartTab('clips'); setMediaBook(book); }} onOpenMerge={() => { setMediaVideoId(''); setMediaStartTab('merges'); setMediaBook(book); }} /></div>
          <div className="shuihuo-workbench-cell batch-factory-actions">
            <div className="batch-factory-action-group is-utility"><span>资料与流程</span><div className="batch-factory-action-button-grid"><Button size="small" onClick={() => setViewingBook(book)}>查看资料</Button>{previewText ? <Button size="small" onClick={() => refreshBatch()} disabled={Boolean(actionBusy)}>刷新状态</Button> : <Button size="small" type="primary" onClick={() => fetchMissingBookSource(book)} loading={actionBusy === `source-${book.id}`} disabled={Boolean(actionBusy)}>获取正文</Button>}</div></div>
            <div className="batch-factory-action-group is-production"><span>资产获取</span><div className="batch-factory-action-button-grid"><Tooltip title={runCapability.available ? '提取当前书的人物、场景、道具提示词；手动资产保留。' : runCapability.reason}><Button size="small" onClick={() => runBookStageAction(book, 'assets', 'force')} loading={actionBusy === stageActionKey('assets', book.id)} disabled={!runCapability.available || Boolean(actionBusy)}>提取</Button></Tooltip><Tooltip title="打开资产图选择与生成面板；选择资产和图片模型后生成。"><Button size="small" onClick={() => setAssetBook(book)} disabled={Boolean(actionBusy)}>生成图片</Button></Tooltip></div></div>
            <div className="batch-factory-action-group is-production"><span>视频获取</span><div className="batch-factory-action-button-grid"><Tooltip title={runCapability.available ? '生成本书结构化导演分镜。视觉基线始终后台保存；仅在“约束设置 → 画面前缀”开启智能统一时显示并注入最终 Prompt。' : runCapability.reason}><Button size="small" onClick={() => runBookStageAction(book, 'director', 'force')} loading={actionBusy === stageActionKey('director', book.id)} disabled={!runCapability.available || Boolean(actionBusy)}>提取</Button></Tooltip><Tooltip title={productionCapability.available ? '按当前书最终编译视频提示词、可用参考图和画幅创建 VIDEO 任务。' : productionCapability.reason}><Button size="small" className="batch-factory-action-video" onClick={() => runBookStageAction(book, 'video')} loading={actionBusy === stageActionKey('video', book.id)} disabled={!productionCapability.available || Boolean(actionBusy)}>生成视频</Button></Tooltip></div></div>
            <div className="batch-factory-action-group is-production"><span>画面获取</span><div className="batch-factory-action-button-grid"><Tooltip title={runCapability.available ? '根据已生成的分镜卡（视频提示词）和画面提示词预设，生成每张分镜的画面提示词。' : runCapability.reason}><Button size="small" onClick={() => runBookStageAction(book, 'visual', 'force')} loading={actionBusy === stageActionKey('visual', book.id)} disabled={!runCapability.available || Boolean(actionBusy)}>提取</Button></Tooltip><Tooltip title="画面首帧图片生成服务尚未配置；可先在分镜提示词中查看或编辑画面提示词。"><Button size="small" disabled>生成图片</Button></Tooltip></div></div>
            <div className="batch-factory-action-group is-recovery"><span>异常处理</span><div className="batch-factory-action-button-grid"><Button size="small" onClick={() => refreshBatch()} disabled={Boolean(actionBusy)}>刷新</Button><Button size="small" danger onClick={() => retryLastFailedStage(book)} loading={actionBusy === stageActionKey('retry', book.id)} disabled={Boolean(actionBusy) && actionBusy !== stageActionKey('retry', book.id)}>重试失败步骤</Button></div></div>
          </div>
        </article>;
      })}
      {!books.length ? <div className="shuihuo-workbench-empty">当前批量还没有小说。返回个人作品后，从“批量工厂”新建书单。</div> : null}
    </div>

    <Modal title={`小说列表 · ${books.length} 本`} open={novelListOpen} onCancel={() => setNovelListOpen(false)} footer={null} width="min(1480px, calc(100vw - 48px))" className="batch-factory-novel-modal"><NovelMetadata books={books} createdAt={batch?.createdAt} selectedBookIds={selectedBookIds} onSelectionChange={setSelectedBookIds} onViewBook={setViewingBook} platformNames={platformNames} productionStatus={productionStatus} mergeStatus={mergeStatus} stageSummaries={stageSummaries} /></Modal>
    <Modal title={viewingBook?.title || '小说详情'} open={Boolean(viewingBook)} onCancel={() => setViewingBook(null)} footer={viewingBook ? <Space><Button loading={actionBusy === `classify-${viewingBook.id}`} onClick={() => classifyBookMetadata(viewingBook)}>AI 判断发布信息</Button>{isBookUploadedTo121(viewingBook) ? <Button danger onClick={() => { setSelectedBookIds([viewingBook.id]); setViewingBook(null); setUploadMode('reupload'); }}>重新上传</Button> : null}<Button onClick={() => openContentEditor(viewingBook)}>编辑生产内容</Button><Button onClick={() => openMetadataEditor(viewingBook)}>编辑列表信息</Button></Space> : null} width={860} className="batch-factory-book-detail-modal">{viewingBook ? (() => { const summary = stageSummaries[viewingBook.id]; const state = batchFactoryBookState(viewingBook, { productionStatus, mergeStatus, stageSummary: summary }); const timeline = batchFactoryBookTimeline(viewingBook, { productionStatus, mergeStatus, stageSummary: summary }); const uploadProgress = uploadProgressForBook(viewingBook); const uploadHistory = Array.isArray(viewingBook?.sourceMetadata?.websiteSubmitHistory) ? viewingBook.sourceMetadata.websiteSubmitHistory : []; return <div className="batch-factory-book-detail"><section className="batch-factory-book-detail-status"><h3>流程异常与生成状态</h3><div><Tag color={state.tone}>{state.label}</Tag><strong>{state.detail}</strong></div>{uploadProgress ? <Alert type={uploadProgress.status === 'failed' ? 'error' : 'info'} showIcon message={`121 上传：${uploadProgress.message || uploadProgress.phase}`} description={`阶段：${uploadProgress.phase || '—'} · ${uploadProgress.updatedAt || '—'}`} /> : null}{state.label === '异常' ? <Button danger size="small" loading={actionBusy === stageActionKey('retry', viewingBook.id)} onClick={() => retryLastFailedStage(viewingBook)}>重试失败步骤</Button> : null}<div className="batch-factory-production-timeline is-detail">{timeline.map(item => <div className={`is-${item.status}`} key={item.key}><i aria-hidden="true" /><span>{item.label}</span><small>{item.detail}</small></div>)}</div></section><section className="batch-factory-book-detail-content"><h3>小说正文</h3><pre>{viewingBook.workingFrontContent || viewingBook.sourceText || '尚未获取原文。'}</pre></section><Descriptions bordered size="small" column={2}><Descriptions.Item label="Book ID">{viewingBook.bookId || '—'}</Descriptions.Item><Descriptions.Item label="书城">{bookPlatformName(viewingBook, platformNames)}</Descriptions.Item><Descriptions.Item label="风格">{value(viewingBook.sourceMetadata, 'style')}</Descriptions.Item><Descriptions.Item label="男女频">{value(viewingBook.sourceMetadata, 'gender')}</Descriptions.Item><Descriptions.Item label="标签">{value(viewingBook.sourceMetadata, 'tags')}</Descriptions.Item><Descriptions.Item label="AI 判断">{classificationLabel(viewingBook.sourceMetadata)}</Descriptions.Item><Descriptions.Item label="来源">{value(viewingBook.sourceMetadata, 'sourceMode') === 'manual_original' ? '手动书单' : '小说获取'}</Descriptions.Item></Descriptions>{uploadHistory.length ? <section className="batch-factory-book-upload-history"><h3>121 上传历史</h3>{uploadHistory.slice().reverse().map((item, index) => <p key={`${item.submittedAt || 'history'}-${index}`}>{item.submittedAt || '—'} · {item.status || '—'} · {item.detail || '—'}</p>)}</section> : null}</div>; })() : null}</Modal>
    <Modal title={metadataBook ? `编辑列表信息 · ${metadataBook.title}` : '编辑列表信息'} open={Boolean(metadataBook)} onCancel={() => setMetadataBook(null)} onOk={saveBookMetadata} confirmLoading={metadataSaving} okText="保存" width={620}>{metadataBook ? <Space direction="vertical" size={12} style={{ width: '100%' }}><Alert type="info" showIcon message="此处保存风格、男女频、标签、推荐理由和评级" description="不会改动小说正文或书城来源。" />{[['style', '风格'], ['gender', '男女频'], ['tags', '标签'], ['reason', '推荐理由'], ['rating', '评级']].map(([key, label]) => <label key={key} className="batch-factory-engine-field"><span><b>{label}</b></span><Input value={metadataValue[key] || ''} onChange={event => setMetadataValue(current => ({ ...current, [key]: event.target.value }))} /></label>)}</Space> : null}</Modal>
    <Modal title={editingContentBook ? `编辑生产内容 · ${editingContentBook.title}` : '编辑生产内容'} open={Boolean(editingContentBook)} onCancel={() => setEditingContentBook(null)} onOk={saveWorkingContent} confirmLoading={contentSaving} okText="保存生产内容" width={820} destroyOnClose><Space direction="vertical" size={14} style={{ width: '100%' }}><Alert type="info" showIcon message="只编辑当前小说用于 AI 推理的视频生产内容" description="原文会继续完整保存；未开启“改文后上传”时，121 仍上传本次内容截取保存的原文。" /><Input.TextArea rows={16} value={editingContentValue} onChange={event => { setEditingContentValue(event.target.value); setEditingContentMode('custom'); }} placeholder="输入当前小说的生产内容" /><label className="shuihuo-form-label"><span>衍生开篇</span><Select value={derivedOpeningPresetId || undefined} onChange={setDerivedOpeningPresetId} options={derivedOpeningOptions} loading={!derivedOpeningOptions.length} placeholder="选择已发布的衍生开篇提示词" style={{ width: 320 }} /></label>{!workingFrontCapability.available ? <Alert type="warning" showIcon message="当前不能生成爆款候选" description={workingFrontCapability.reason || '请先完成当前书的可执行配置。'} /> : null}<Space wrap><Tooltip title={workingFrontCapability.available ? '按选中的衍生开篇提示词生成候选；不会覆盖当前生产内容' : workingFrontCapability.reason}><Button type="primary" onClick={createViralCandidate} loading={rewritingFront} disabled={!workingFrontCapability.available || !String(editingContentValue || '').trim() || !derivedOpeningPresetId}>生成爆款候选</Button></Tooltip><Tooltip title={workingFrontCapability.available ? '按当前选择的同一提示词重新生成候选；不会覆盖当前生产内容' : workingFrontCapability.reason}><Button onClick={createViralCandidate} loading={rewritingFront} disabled={!workingFrontCapability.available || !String(editingContentValue || '').trim() || !derivedOpeningPresetId}>重试生成爆款候选</Button></Tooltip></Space>{viralCandidate ? <Alert type="warning" showIcon message="爆款候选尚未替换" description={<Space direction="vertical" size={8} style={{ width: '100%' }}><pre className="batch-factory-viral-candidate">{viralCandidate}</pre><Space><Button type="primary" onClick={() => { setEditingContentValue(viralCandidate); setEditingContentMode('viral'); }}>替换为当前生产内容</Button><Button onClick={cancelViralCandidate}>取消候选</Button></Space></Space>} /> : null}</Space></Modal>
    <BatchFactoryBookSettingsModal open={Boolean(configTarget)} batch={batch} book={configTarget?.book} activeRegion={configTarget?.region} onClose={() => setConfigTarget(null)} onSaved={refreshAfterBookSettingsSaved} onOpenBookAssets={book => setAssetBook(book)} />
    <Modal title={assetBook ? `人物场景预设 · ${assetBook.title}` : '人物场景预设'} open={Boolean(assetBook)} onCancel={() => setAssetBook(null)} footer={null} width="min(1440px, calc(100vw - 48px))" className="batch-factory-assets-modal">{assetBook ? <AssetEditor book={assetBook} batchId={batch?.id} onSaved={refreshBatch} onGenerate={async textModelId => { await refreshAssetPresetSnapshot(assetBook); await runBookStageAction(assetBook, 'assets', 'missing', '', textModelId); }} onRegenerate={async textModelId => { await refreshAssetPresetSnapshot(assetBook); await runBookStageAction(assetBook, 'assets', 'force', '', textModelId); }} onRetry={textModelId => retryLastFailedStage(assetBook, '', textModelId)} assetRules={effectiveBookAssetRules(batch, assetBook)} onAssetPromptChange={async selection => { const bookPromptConfig = assetBook?.settingsState?.patch?.aiPromptConfig || {}; const assetRules = effectiveBookAssetRules(batch, assetBook); await saveBookOverrideWithRetry(batch.id, assetBook.id, assetBook.revision, { patch: { aiPromptConfig: { ...bookPromptConfig, assets: { ...assetRules, extraction: selection, scope: 'custom', bookIds: [assetBook.id] } } } }); await refreshBatch(); }} canGenerate={runCapability.available} generateReason={runCapability.reason} generating={actionBusy === stageActionKey('assets', assetBook.id)} engineSettings={effectiveBookSettings(batch, assetBook)} /> : null}</Modal>
	<Modal title={promptBook ? `分镜卡（视频提示词） · ${promptBook.title}` : '分镜卡（视频提示词）'} open={Boolean(promptBook)} onCancel={() => { setPromptBook(null); setPromptVideoId(''); }} footer={null} width={900} className="batch-factory-prompt-modal">{promptBook ? <PromptPanel book={promptBook} batchId={batch?.id} settingsRevision={batch?.settingsState?.revision} initialVideoId={promptVideoId} onSaved={refreshBatch} onRegenerate={() => runBookStageAction(promptBook, 'director', 'force')} onRegenerateVisual={() => runBookStageAction(promptBook, 'visual', 'force')} onRetry={videoId => retryLastFailedStage(promptBook, videoId)} onGenerateVideo={videoId => runBookStageAction(promptBook, 'video', 'missing', videoId)} onViewVideoCandidates={videoId => { setMediaVideoId(videoId || ''); setMediaStartTab('clips'); setMediaBook(promptBook); }} onGenerateVisual={() => setAssetBook(promptBook)} onViewVisualCandidates={() => setAssetBook(promptBook)} regenerating={actionBusy === stageActionKey('director', promptBook.id) || actionBusy === stageActionKey('video', promptBook.id) || actionBusy === stageActionKey('retry', promptBook.id)} productionAvailable={productionCapability.available} productionReason={productionCapability.reason} /> : null}</Modal>
	<Modal
      title={mediaBook ? `片段库 · ${mediaBook.title}` : '片段库'}
      open={Boolean(mediaBook)}
      onCancel={() => { setMediaBook(null); setMediaVideoId(''); setMediaStartTab('clips'); }}
      footer={null}
      width="min(1180px, calc(100vw - 40px))"
      className="batch-factory-media-library-modal"
      destroyOnClose
    >
      {mediaBook ? <MediaVersionPanel
        book={mediaBook}
        batchId={batch?.id}
        versionsByVideo={mediaVersionsByVideo}
        productionStatus={productionStatus}
        mergeJob={latestBookMerge(mergeStatus, mediaBook.id)}
        mergeJobs={bookMergeJobs(mergeStatus, mediaBook.id)}
        mergeSettings={effectiveBookSettings(batch, mediaBook)}
        mergeSpeed={mergeSpeed}
        onMergeSpeedChange={setMergeSpeed}
        onMerge={options => runBookMerge(mediaBook, options)}
        mergeAvailable={mergeCapability.available}
        mergeReason={mergeCapability.reason}
        merging={actionBusy === `merge-${mediaBook.id}`}
        onSaved={async () => { await refreshBatch(); await loadRuntimeStatus({ quiet: true }); }}
        onDeleted={async () => { await refreshBatch(); await loadRuntimeStatus({ quiet: true }); }}
        onUpload={() => { setSelectedBookIds([mediaBook.id]); setMediaBook(null); setMediaVideoId(''); setMediaStartTab('clips'); setUploadMode('selected'); }}
        onRegenerate={videoId => runBookStageAction(mediaBook, 'video', 'force', videoId)}
        onRetry={videoId => retryLastFailedStage(mediaBook, videoId)}
        regenerating={actionBusy === stageActionKey('video', mediaBook.id) || actionBusy === stageActionKey('retry', mediaBook.id)}
        productionAvailable={productionCapability.available}
        productionReason={productionCapability.reason}
        initialVideoId={mediaVideoId}
        initialTab={mediaStartTab}
      /> : null}
    </Modal>

    <BatchFactoryUnifiedSettingsModal open={unifiedSettingsOpen} batch={batch} onClose={() => setUnifiedSettingsOpen(false)} onSaved={saveSettings} />
    <Modal title="任务 / 日志" open={logsOpen} onCancel={() => setLogsOpen(false)} footer={<Button onClick={() => loadRuntimeStatus()}>刷新状态</Button>} width={860}><BatchLogs automationStatus={automationStatus} productionStatus={productionStatus} mergeStatus={mergeStatus} error={logsError} /></Modal>
    <Modal title="开始定时" open={automationStartOpen} onCancel={() => setAutomationStartOpen(false)} onOk={() => runAutomationAction('start')} confirmLoading={automationBusy === 'start'} okText={automationScheduledAt ? '保存定时任务' : '立即开始'} width={620} destroyOnClose>
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <label className="batch-factory-engine-field"><span><b>自动化预设</b></span><Select value={automationPresetID || undefined} onChange={setAutomationPresetID} placeholder="选择已保存预设" options={automationPresets.map(item => ({ value: item.id, label: `${item.name} · v${item.version}` }))} style={{ width: '100%' }} /></label>
        <label className="batch-factory-engine-field"><span><b>执行模式</b></span><Select value={automationRunMode} onChange={setAutomationRunMode} style={{ width: '100%' }} options={[{ value: 'storyboard_only', label: '只生成分镜' }, { value: 'video_no_submit', label: '生成视频不提交' }, { value: 'full_submit', label: '全自动生成并提交' }]} /></label>
        <label className="batch-factory-engine-field"><span><b>执行时间</b></span><Input type="datetime-local" value={automationScheduledAt} onChange={event => setAutomationScheduledAt(event.target.value)} placeholder="留空则立即执行" /></label>
      </Space>
    </Modal>
    <UploadNetwork batch={batch} books={books} selectedBookIds={selectedBookIds} productionStatus={productionStatus} mergeStatus={mergeStatus} mode={uploadMode} onClose={() => setUploadMode('')} onOpenPublish={() => { setUploadMode(''); setUnifiedSettingsOpen(true); }} onRefresh={refreshBatch} />
  </section>;
}
