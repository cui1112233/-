import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  BarsOutlined,
  FileTextOutlined,
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
  getMergeStatus,
  getProductionStatus,
  getPublishCredential,
  getChangeImpact,
  runBatchDirector,
  runDirector,
  saveBatchSettings,
  saveDraft,
  submitBatchMerge,
  submitBatchProduction,
  submitBookProduction
} from '../../../shared/api/batchFactoryV11';
import { BatchFactoryEngineSettingsDrawer } from './BatchFactoryEngineSettingsDrawer';
import { batchFactoryBookState, batchFactoryNovelTableRow } from './batchFactoryBookState';
import { batchFactoryPreviewText, contentRangeLinesForBook } from './batchFactoryContentRange';

function value(metadata, key) { return String(metadata?.[key] || '').trim() || '—'; }
function resultData(result, key) { return result?.[key] || result || {}; }
function requestID(prefix) { return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`; }
function capability(caps, key) { return caps?.[key] || { available: false, reason: '正在读取 V11 服务能力' }; }
function assetName(asset) { return String(asset?.name || asset?.label || asset?.id || '未命名预设'); }
function assetPrompt(asset) { return String(asset?.prompt || asset?.visualPrompt || asset?.description || ''); }
function savedDraftKey(type, asset) { return `asset:${type}:${asset?.id || assetName(asset)}`; }
function completedMediaMap(status) {
  const entries = new Map();
  for (const job of status?.jobs || []) for (const task of job?.tasks || []) entries.set(task?.videoId, task);
  return entries;
}

function NovelMetadata({ books, createdAt, selectedBookIds, onSelectionChange, onViewBook }) {
  const selected = new Set(selectedBookIds);
  const allSelected = books.length > 0 && books.every(book => selected.has(book.id));
  return <div className="batch-factory-novel-list batch-factory-novel-fetch-list" role="table" aria-label="小说列表">
    <div className="batch-factory-novel-list-head" role="row"><span>推送日期</span><span><Checkbox checked={allSelected} onChange={event => onSelectionChange(event.target.checked ? books.map(book => book.id) : [])} aria-label="全选小说" /></span><span>ID</span><span>书名</span><span>平台</span><span>风格</span><span>男女频</span><span>AI判断</span><span>原文</span><span>AI文案</span><span>网站提交</span><span>状态</span><span>操作</span></div>
    {books.map((book, index) => {
      const row = batchFactoryNovelTableRow(book, index, createdAt);
      const metadata = book.sourceMetadata || {};
      return <div className="batch-factory-novel-list-row" key={book.id} role="row">
        <span>{row.createdAt}</span><span><Checkbox checked={selected.has(book.id)} onChange={event => onSelectionChange(event.target.checked ? [...selected, book.id] : [...selected].filter(id => id !== book.id))} aria-label={`选择 ${row.title}`} /></span><span className="batch-factory-book-id">{row.bookId}</span><strong title={row.title}>{row.title}</strong><span>{metadata.platformName || book.platform || '—'}</span><span>{value(metadata, 'style')}</span><span>{value(metadata, 'gender')}</span><span>{metadata.classifyStatus || '—'}</span><span className={row.original === '✓' ? 'is-ready' : ''}>{row.original}</span><span>{row.ai1}</span><span>{row.websiteSubmit}</span><span className={row.status === '定时待执行' ? 'is-scheduled' : ''}>{row.status}</span><span><Button size="small" onClick={() => onViewBook(book)}>查看</Button></span>
      </div>;
    })}
  </div>;
}

function AssetEditor({ book, batchId, onSaved }) {
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const groups = [
    ['character', '人物', book?.assets?.characters || []],
    ['scene', '场景', book?.assets?.scenes || []],
    ['prop', '道具', book?.assets?.props || []]
  ];
  useEffect(() => {
    const initial = {};
    for (const [type, , items] of groups) for (const item of items) initial[`${type}:${savedDraftKey(type, item)}`] = assetPrompt(item);
    setDrafts(initial);
  }, [book?.id]);
  async function save() {
    setSaving(true);
    try {
      await Promise.all(groups.flatMap(([type, , items]) => items.map(asset => saveDraft({ key: savedDraftKey(type, asset), kind: 'asset-prompt', scope: batchId, content: drafts[`${type}:${savedDraftKey(type, asset)}`] ?? '' }))));
      message.success('当前小说的预设 Prompt 已保存');
      await onSaved?.();
    } catch (error) { message.error(error?.message || '保存预设 Prompt 失败'); } finally { setSaving(false); }
  }
  return <>
    <Alert type="info" showIcon message="当前小说预设" description="这里读取 AI 推理回写的人物、场景、道具；编辑后会保存到 V11 Prompt 草稿，供该书的最终提示词编译使用。图片生成和替换将在 V11 资产图片接口接入后开放，当前不会显示虚构图片。" />
    <div className="batch-factory-asset-editor">
      {groups.map(([type, label, items]) => <section key={type} className="batch-factory-asset-group"><strong>{label}</strong>{items.length ? items.map(asset => <label key={savedDraftKey(type, asset)}><span>{assetName(asset)}</span><Input.TextArea rows={3} value={drafts[`${type}:${savedDraftKey(type, asset)}`] ?? ''} onChange={event => setDrafts(current => ({ ...current, [`${type}:${savedDraftKey(type, asset)}`]: event.target.value }))} /></label>) : <p>尚未有该书的{label}数据。先从“AI 推理”执行资产设置。</p>}</section>)}
    </div>
    <div className="batch-factory-modal-actions"><Button type="primary" loading={saving} onClick={save} disabled={!groups.some(([, , items]) => items.length)}>保存预设 Prompt</Button></div>
  </>;
}

function PromptPanel({ book, batchId }) {
  const [selectedVideoId, setSelectedVideoId] = useState(book?.videos?.[0]?.id || '');
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState(null);
  const videos = book?.videos || [];
  useEffect(() => { setSelectedVideoId(book?.videos?.[0]?.id || ''); setPrompt(null); }, [book?.id]);
  async function loadPrompt() {
    if (!selectedVideoId) return;
    setLoading(true);
    try { setPrompt(resultData(await getFinalPrompt(batchId, book.id, selectedVideoId), 'prompt')); } catch (error) { message.error(error?.message || '读取最终提示词失败'); } finally { setLoading(false); }
  }
  return <><Space wrap><Select value={selectedVideoId || undefined} onChange={setSelectedVideoId} style={{ minWidth: 210 }} placeholder="选择分镜 / VIDEO" options={videos.map(video => ({ value: video.id, label: video.label || video.id }))} /><Button onClick={loadPrompt} loading={loading} disabled={!selectedVideoId}>读取最终提示词</Button></Space>{prompt ? <pre className="batch-factory-final-prompt">{prompt?.compiled || prompt?.content || JSON.stringify(prompt, null, 2)}</pre> : <p className="shuihuo-modal-note">AI 推理完成后，每个 VIDEO 的最终提示词由 V11 编译器实时生成。</p>}</>;
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
      const result = await createPublishIntent('121', {
        batchId: batch.id,
        bookId: targetBooks.length === 1 ? targetBooks[0].id : '',
        payload: {
          batchId: batch.id,
          books: targetBooks.map(book => ({ id: book.id, bookId: book.bookId, title: book.title, platform: book.platform, sourceText: book.sourceText })),
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
  const [promptBook, setPromptBook] = useState(null);
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
  const books = Array.isArray(batch?.books) ? batch.books : [];
  const readyBooks = books.filter(book => String(book?.sourceText || '').trim()).length;
  const progress = books.length ? Math.round((readyBooks / books.length) * 100) : 0;
  const mediaByVideoId = useMemo(() => completedMediaMap(productionStatus), [productionStatus]);
  const totalVideos = books.reduce((count, book) => count + (book?.videos?.length || 0), 0);
  const runCapability = capability(capabilities, 'director.run');
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
  useEffect(() => { setSelectedBookIds(current => current.filter(id => books.some(book => book.id === id))); }, [batch?.id, books.length]);

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
        <Tooltip title="按当前小说保存人物、场景、道具 Prompt；数据来自 AI 推理回写"><Button type="text" icon={<AppstoreOutlined />} onClick={() => setAssetBook(books[0] || null)} disabled={!books.length}>人物场景预设</Button></Tooltip>
        <Button type="text" icon={<SettingOutlined />} onClick={() => setEngineOpen(true)}>引擎配置</Button>
        <Tooltip title={runCapability.available ? '生成资产、画面和视频提示词' : runCapability.reason}><Button type="text" icon={<FileTextOutlined />} disabled={!runCapability.available} onClick={() => setAiOpen(true)}>AI 推理</Button></Tooltip>
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
          <div className="shuihuo-workbench-cell batch-factory-book-content"><strong>{book.title || `小说 ${index + 1}`}</strong><span>bookId：{book.bookId || '—'} · 书城：{book.platform || '—'} · 展示前 {rangeLines} 行</span><p>{previewText || '原文尚未获取。创建前须按保存的书城与 bookId 抓取原文。'}</p></div>
          <div className="shuihuo-workbench-cell batch-factory-placeholder"><strong>人物 / 场景 / 道具</strong><span>{(book.assets?.characters?.length || 0) + (book.assets?.scenes?.length || 0) + (book.assets?.props?.length || 0)} 条真实预设</span><Button size="small" onClick={() => setAssetBook(book)} disabled={!String(book.sourceText || '').trim()}>打开预设</Button></div>
          <div className="shuihuo-workbench-cell batch-factory-placeholder"><strong>画面 / 视频提示词</strong><span>{videos.length ? `${videos.length} 个 VIDEO 可读取最终提示词` : 'AI 推理后在本行保存。'}</span><Button size="small" onClick={() => setPromptBook(book)} disabled={!videos.length}>查看提示词</Button></div>
          <div className="shuihuo-workbench-cell batch-factory-clips"><strong>分镜 / VIDEO</strong>{videos.length ? videos.slice(0, 4).map(video => { const task = mediaByVideoId.get(video.id); return <div key={video.id} className="batch-factory-video-chip"><span>{video.label || 'VIDEO'}</span><Tag color={task?.status === 'succeeded' ? 'green' : task?.status === 'failed' ? 'red' : task?.status === 'running' ? 'blue' : 'default'}>{task?.status || '待生成'}</Tag></div>; }) : <span>AI 推理完成后生成分镜。</span>}<Button size="small" disabled={!videos.length || !productionCapability.available} loading={actionBusy === 'production'} onClick={() => runProduction(book)}>生成视频</Button></div>
          <div className="shuihuo-workbench-cell batch-factory-actions"><Tag color={state.tone}>{state.label}</Tag><span>{state.detail}</span><Button type="link" size="small" onClick={() => setViewingBook(book)}>查看资料</Button></div>
        </article>;
      })}
      {!books.length ? <div className="shuihuo-workbench-empty">当前批量还没有小说。返回个人作品后，从“批量工厂”新建书单。</div> : null}
    </div>

    <Modal title={`小说列表 · ${books.length} 本`} open={novelListOpen} onCancel={() => setNovelListOpen(false)} footer={null} width="min(1480px, calc(100vw - 48px))" className="batch-factory-novel-modal"><NovelMetadata books={books} createdAt={batch?.createdAt} selectedBookIds={selectedBookIds} onSelectionChange={setSelectedBookIds} onViewBook={setViewingBook} /></Modal>
    <Modal title={viewingBook?.title || '小说详情'} open={Boolean(viewingBook)} onCancel={() => setViewingBook(null)} footer={null} width={720} className="batch-factory-book-detail-modal"><Descriptions bordered size="small" column={1}>{viewingBook ? <><Descriptions.Item label="Book ID">{viewingBook.bookId || '—'}</Descriptions.Item><Descriptions.Item label="书城">{viewingBook.platform || '—'}</Descriptions.Item><Descriptions.Item label="男女频">{value(viewingBook.sourceMetadata, 'gender')}</Descriptions.Item><Descriptions.Item label="类型">{value(viewingBook.sourceMetadata, 'style')}</Descriptions.Item><Descriptions.Item label="来源">{value(viewingBook.sourceMetadata, 'sourceMode') === 'manual_original' ? '手动书单' : '小说获取'}</Descriptions.Item><Descriptions.Item label="正文保存">{String(viewingBook.sourceText || '').length} 字</Descriptions.Item><Descriptions.Item label="原文状态">{batchFactoryBookState(viewingBook).detail}</Descriptions.Item></> : null}</Descriptions></Modal>
    <Modal title={assetBook ? `人物场景预设 · ${assetBook.title}` : '人物场景预设'} open={Boolean(assetBook)} onCancel={() => setAssetBook(null)} footer={null} width={900} className="batch-factory-assets-modal">{assetBook ? <AssetEditor book={assetBook} batchId={batch?.id} onSaved={refreshBatch} /> : null}</Modal>
    <Modal title={promptBook ? `最终提示词 · ${promptBook.title}` : '最终提示词'} open={Boolean(promptBook)} onCancel={() => setPromptBook(null)} footer={null} width={900}>{promptBook ? <PromptPanel book={promptBook} batchId={batch?.id} /> : null}</Modal>
    <Modal title="AI 推理" open={aiOpen} onCancel={() => setAiOpen(false)} footer={null} width={620}><Space direction="vertical" size={14} style={{ width: '100%' }}><Alert type="info" showIcon message="AI 推理只生成资产、画面与视频 Prompt" description="它不会自动提交视频、合并或121。完成后，结果会回写到每本小说这一行。" /><Button type="primary" loading={actionBusy === 'director'} onClick={() => runAi('all')}>对全部 {books.length} 本小说执行 AI 推理</Button><Select placeholder="选择单本小说" options={books.filter(book => String(book.sourceText || '').trim()).map(book => ({ value: book.id, label: `${book.title || '未命名'} · ${book.bookId || '—'}` }))} onChange={id => runAi(books.find(book => book.id === id))} disabled={actionBusy === 'director'} /></Space></Modal>
    <Modal title="任务 / 日志" open={logsOpen} onCancel={() => setLogsOpen(false)} footer={<Button onClick={() => loadRuntimeStatus()}>刷新状态</Button>} width={860}><BatchLogs productionStatus={productionStatus} mergeStatus={mergeStatus} error={logsError} /></Modal>
    <UploadNetwork batch={batch} books={books} selectedBookIds={selectedBookIds} capabilities={capabilities} productionStatus={productionStatus} mergeStatus={mergeStatus} mode={uploadMode} onClose={() => setUploadMode('')} />
    <BatchFactoryEngineSettingsDrawer open={engineOpen} batch={batch} onClose={() => setEngineOpen(false)} onSave={saveSettings} />
  </section>;
}
