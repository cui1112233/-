import { Alert, Button, Empty, Input, Modal, Space, Spin, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as batchFactoryV11 from '../../../shared/api/batchFactoryV11.js';
import { BatchFactoryV11Workbench } from './BatchFactoryV11Workbench';
import { ProductionSettingsDrawer } from './BatchFactoryV11SettingsDrawers';
import { PublishSettingsDrawer } from './BatchFactoryV11PublishSettings';
import { BookSettingsModal, VideoSettingsDrawer } from './BatchFactoryV11ScopedSettings';
import { DirectorRefreshProvider } from './DirectorRefreshContext.jsx';
import { FinalPromptPreviewDrawer } from './FinalPromptPreviewDrawer.jsx';
import { actionState, intakeCreateState } from './batchFactoryV11State.js';
import { createBf11UiAdapter } from './bf11UiAdapter.js';
import { createBf11Runtime, createdBatchIdFrom } from './bf11Runtime.js';
import './batch-factory-v11-scoped.css';
import './batch-factory-v11-detail.css';
import './batch-factory-v11-theme.css';

function requestParamsFromLocation() {
  if (typeof window === 'undefined') return {};
  const search = new URLSearchParams(window.location.search || '');
  return {
    batchId: search.get('batch') || '',
    intakeId: search.get('intake') || ''
  };
}

function emptySettingsState() {
  return { patch: {}, revision: 0, snapshot: null, compatibility: [] };
}

function batchForView(batch, books) {
  if (!batch) return null;
  return {
    ...batch,
    title: batch.title || `批次 ${batch.id}`,
    count: Number(batch.count ?? books.length)
  };
}

export function BatchFactoryV11UiPage() {
  const adapter = useMemo(() => createBf11UiAdapter(batchFactoryV11), []);
  const runtime = useMemo(() => createBf11Runtime({ adapter }), [adapter]);
  const requestParams = useMemo(requestParamsFromLocation, []);
  const [runtimeState, setRuntimeState] = useState({ phase: 'loading' });
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [productionSettingsOpen, setProductionSettingsOpen] = useState(false);
  const [bookSettingsTargetId, setBookSettingsTargetId] = useState('');
  const [videoSettingsTarget, setVideoSettingsTarget] = useState(null);
  const [directorAction, setDirectorAction] = useState({ type: '', bookId: '' });
  const [promptPreview, setPromptPreview] = useState({ open: false, loading: false, data: null, error: '' });
  const [productionBusy, setProductionBusy] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [publishSettingsOpen, setPublishSettingsOpen] = useState(false);
  const [batchManagerOpen, setBatchManagerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [newBatchTitle, setNewBatchTitle] = useState('');
  const [historyBatches, setHistoryBatches] = useState([]);

  const reload = useCallback(async ({ announce = false } = {}) => {
    setRuntimeState(current => ({ ...current, phase: 'loading' }));
    const next = await runtime.load(requestParams);
    setRuntimeState(next);
    if (announce && next.phase === 'ready') message.success('已刷新 V11 工作台');
    return next;
  }, [runtime, requestParams]);

  useEffect(() => {
    let cancelled = false;
    runtime.load(requestParams).then(next => {
      if (!cancelled) setRuntimeState(next);
    });
    return () => { cancelled = true; };
  }, [runtime, requestParams]);

  if (runtimeState.phase === 'loading') {
    return <div data-bf-v11-ui="final" style={{ minHeight: 420, display: 'grid', placeItems: 'center' }}>
      <Spin size="large" tip="正在读取 Batch Factory V11…" />
    </div>;
  }

  if (runtimeState.phase === 'error') {
    return <div data-bf-v11-ui="final" style={{ minHeight: 420, display: 'grid', placeItems: 'center' }}>
      <Alert
        type="error"
        showIcon
        message="Batch Factory V11 暂时不可用"
        description={<div>
          <Typography.Paragraph>{runtimeState.message}</Typography.Paragraph>
          <Button onClick={() => reload()}>重新加载</Button>
        </div>}
      />
    </div>;
  }

  const batch = runtimeState.batch;
  const books = runtimeState.books || [];
  const capabilities = runtimeState.capabilities || {};
  const batchCreateAction = actionState(capabilities, 'batch.create');
  const intakeState = intakeCreateState(runtimeState.intake);
  const batchSettingsState = batch?.settingsState || emptySettingsState();
  const viewBatch = batchForView(batch, books);

  async function createBatchFromIntake() {
    if (!intakeState.intakeId || intakeState.consumed || batchCreateAction.disabled || creatingBatch) return false;
    setCreatingBatch(true);
    try {
      const result = await runtime.createBatchFromIntake({ intakeId: intakeState.intakeId, payload: {} });
      if (!result.ok) {
        message.error(result.message);
        return false;
      }
      const createdBatchId = createdBatchIdFrom(result.raw);
      const next = await runtime.load(createdBatchId
        ? { ...requestParams, batchId: createdBatchId }
        : requestParams);
      setRuntimeState(next);
      if (next.phase !== 'ready' || !next.batch) {
        message.warning('批次已创建，但重新读取工作台失败，请刷新后继续。');
        return true;
      }
      message.success('V11 批次已创建；Director 尚未启动。');
      return true;
    } finally {
      setCreatingBatch(false);
    }
  }

  if (!batch) {
    const intake = runtimeState.intake;
    const intakeStatus = intake?.status || (intakeState.consumed ? '已消费' : '待创建批次');
    const intakeCount = Number(intake?.bookCount ?? intake?.count ?? 0);
    const createDisabledReason = intakeState.consumed
      ? '该 Intake 已经被消费，不能重复创建批次。'
      : batchCreateAction.reason;

    return <div data-bf-v11-ui="final" style={{ minHeight: 460, display: 'grid', placeItems: 'center' }}>
      <Empty
        description={intake ? <Space direction="vertical" size={8}>
          <Typography.Text>已读取小说获取转入任务，等待你明确创建 V11 批次。</Typography.Text>
          <Space wrap>
            <Tag>Intake {intake.id || '—'}</Tag>
            <Tag color={intakeState.consumed ? 'default' : 'processing'}>{intakeStatus}</Tag>
            {intake.sourceTaskId ? <Tag>来源 {intake.sourceTaskId}</Tag> : null}
            {intakeCount > 0 ? <Tag>{intakeCount} 本</Tag> : null}
          </Space>
          <Typography.Text type="secondary">创建批次不会自动启动 Director。</Typography.Text>
        </Space> : '当前没有 Batch Factory V11 批次。'}
      >
        <Space wrap>
          {intake ? <Button
            type="primary"
            loading={creatingBatch}
            disabled={creatingBatch || intakeState.consumed || batchCreateAction.disabled || !intakeState.intakeId}
            title={createDisabledReason}
            onClick={createBatchFromIntake}
          >创建 V11 批次</Button> : null}
          <Button onClick={() => reload({ announce: true })}>刷新批次</Button>
        </Space>
      </Empty>
    </div>;
  }

  const activeBook = bookSettingsTargetId
    ? books.find(book => book.id === bookSettingsTargetId) || null
    : null;
  const activeVideoBook = videoSettingsTarget
    ? books.find(book => book.id === videoSettingsTarget.bookId) || null
    : null;
  const activeVideo = activeVideoBook && videoSettingsTarget
    ? (activeVideoBook.videos || []).find(video => video.id === videoSettingsTarget.videoId) || null
    : null;

  async function saveScope(input, successMessage) {
    const result = await runtime.save(input);
    if (!result.ok) {
      message.error(result.message);
      return false;
    }
    message.success(successMessage);
    const next = await runtime.load(requestParams);
    setRuntimeState(next);
    if (next.phase !== 'ready') {
      message.warning('设置已保存，但重新读取工作台失败，请稍后刷新。');
    }
    return true;
  }

  function previewBatchChangeImpact(patch) {
    return runtime.previewChangeImpact({
      batchId: batch.id,
      patch,
      revision: batchSettingsState.revision
    });
  }

  async function refreshDirectorRevision() {
    const next = await runtime.load({ ...requestParams, batchId: batch.id });
    setRuntimeState(next);
    if (next.phase !== 'ready') {
      message.error(next.message || '刷新 Director revision 失败');
      return false;
    }
    message.success('Director revision 已刷新');
    return true;
  }

  function saveBatchSettings(patch) {
    return saveScope({
      scope: 'batch',
      batchId: batch.id,
      patch,
      revision: batchSettingsState.revision
    }, '生产统一设置已保存');
  }

  function syncBatchConfigVersion({ versionConfigId } = {}) {
    if (!versionConfigId) return Promise.resolve(false);
    return saveScope({
      scope: 'batch',
      batchId: batch.id,
      patch: { versionConfigId },
      revision: batchSettingsState.revision
    }, '批量后台配置已同步');
  }

  function saveBookSettings(patch) {
    if (!activeBook) return Promise.resolve(false);
    return saveScope({
      scope: 'book',
      batchId: batch.id,
      bookId: activeBook.id,
      patch,
      revision: activeBook.settingsState?.revision || 0
    }, '当前小说设置已保存');
  }

  function saveVideoSettings(patch) {
    if (!activeVideoBook || !activeVideo) return Promise.resolve(false);
    return saveScope({
      scope: 'video',
      batchId: batch.id,
      bookId: activeVideoBook.id,
      videoId: activeVideo.id,
      patch,
      revision: activeVideo.settingsState?.revision || 0
    }, '单 VIDEO 设置已保存');
  }

  async function finishDirectorAction(result, successMessage) {
    if (!result.ok) { message.error(result.message); return false; }
    const next = await runtime.load({ ...requestParams, batchId: batch.id });
    setRuntimeState(next);
    if (next.phase !== 'ready') { message.warning(`${successMessage}，但重新读取工作台失败，请刷新。`); return true; }
    message.success(successMessage);
    return true;
  }

  async function runHook(book) {
    if (!book?.id || directorAction.type) return false;
    setDirectorAction({ type: 'hook', bookId: book.id });
    try { return await finishDirectorAction(await runtime.runHook({ batchId: batch.id, bookId: book.id }), 'Hook 已生成，等待你审核批准'); }
    finally { setDirectorAction({ type: '', bookId: '' }); }
  }

  async function approveHook(book, hook) {
    if (!book?.id || !hook?.id || directorAction.type) return false;
    setDirectorAction({ type: 'approve', bookId: book.id });
    try { return await finishDirectorAction(await runtime.approveHook({ batchId: batch.id, bookId: book.id, hookId: hook.id }), 'Hook 已批准'); }
    finally { setDirectorAction({ type: '', bookId: '' }); }
  }

  async function runDirector(book) {
    if (!book?.id || directorAction.type) return false;
    setDirectorAction({ type: 'director', bookId: book.id });
    try { return await finishDirectorAction(await runtime.runDirector({ batchId: batch.id, bookId: book.id }), 'Director 已完成并生成新的 VIDEO identity'); }
    finally { setDirectorAction({ type: '', bookId: '' }); }
  }

  async function previewFinalPrompt(book, video) {
    if (!book?.id || !video?.id) return false;
    setPromptPreview({ open: true, loading: true, data: null, error: '' });
    const result = await runtime.previewFinalPrompt({ batchId: batch.id, bookId: book.id, videoId: video.id });
    if (!result.ok) {
      setPromptPreview({ open: true, loading: false, data: null, error: result.message });
      return false;
    }
    setPromptPreview({ open: true, loading: false, data: result.raw, error: '' });
    return true;
  }

  function newRequestId(prefix) {
    const random = globalThis.crypto?.randomUUID?.();
    return `${prefix}-${random || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  }

  async function runProduction(targetBatch) {
    if (!targetBatch?.id || productionBusy) return false;
    setProductionBusy(true);
    try {
      const result = await runtime.runProduction({ batchId: targetBatch.id, requestId: newRequestId('bf11-production') });
      if (!result.ok) { message.error(result.message); return false; }
      const next = await runtime.load({ ...requestParams, batchId: targetBatch.id });
      setRuntimeState(next);
      if (next.phase !== 'ready') { message.warning('视频任务已提交，但刷新状态失败，请稍后重试。'); return true; }
      message.success('待生成 VIDEO 已提交，状态会自动写回工作台。');
      return true;
    } finally {
      setProductionBusy(false);
    }
  }

  async function runMerge(targetBatch, options = {}) {
    if (!targetBatch?.id || mergeBusy) return false;
    setMergeBusy(true);
    try {
      const result = await runtime.runMerge({ batchId: targetBatch.id, requestId: newRequestId('bf11-merge'), ...options });
      if (!result.ok) { message.error(result.message); return false; }
      const next = await runtime.load({ ...requestParams, batchId: targetBatch.id });
      setRuntimeState(next);
      if (next.phase !== 'ready') { message.warning('合并任务已提交，但刷新状态失败，请稍后重试。'); return true; }
      message.success('待合并任务已提交，状态会写回工作台。');
      return true;
    } finally {
      setMergeBusy(false);
    }
  }

  async function runBatchDirector(targetBatch) {
    if (!targetBatch?.id || directorAction.type) return false;
    setDirectorAction({ type: 'batch-director', bookId: '' });
    try {
      const result = await runtime.runBatchDirector({ batchId: targetBatch.id });
      if (!result.ok) { message.error(result.message); return false; }
      const next = await runtime.load({ ...requestParams, batchId: targetBatch.id });
      setRuntimeState(next);
      message.success('批量 Director 已完成；失败项会保留在返回状态中。');
      return true;
    } finally {
      setDirectorAction({ type: '', bookId: '' });
    }
  }

  async function saveVideoPrompt(book, video, visualPrompt) {
    const result = await runtime.saveVideoPrompt({ batchId: batch.id, bookId: book.id, videoId: video.id, visualPrompt, revision: video.settingsState?.revision || 0 });
    if (!result.ok) { message.error(result.message); return false; }
    await reload({ announce: false });
    message.success('画面提示词已保存');
    return true;
  }

  async function saveAssetPrompts(type, items, drafts) {
    try {
      await Promise.all((items || []).map(item => {
      const name = typeof item === 'string' ? item : (item?.name || item?.label || item?.id || '未命名资产');
      const key = `${type}:${item?.id || name}:${items.indexOf(item)}`;
      const content = drafts[key] ?? (typeof item === 'string' ? '' : (item?.prompt || item?.visualPrompt || item?.description || ''));
      return batchFactoryV11.saveDraft({ key: `asset:${type}:${item?.id || name}`, kind: 'asset-prompt', scope: batch.id, content });
      }));
      message.success(`${type === 'character' ? '人物' : type === 'scene' ? '场景' : '道具'} Prompt 草稿已保存`);
      return true;
    } catch (error) {
      message.error(error?.message || '资产 Prompt 草稿保存失败');
      return false;
    }
  }

  async function saveConstraintDraft(payload) {
    const result = await runtime.saveDraft(payload);
    if (!result.ok) { message.error(result.message); return false; }
    message.success('当前草稿已保存');
    return true;
  }

  async function savePersonalPrompt(payload) {
    const result = await runtime.createPrompt(payload);
    if (!result.ok) { message.error(result.message); return false; }
    message.success('已保存为我的提示词');
    return true;
  }

  async function openHistory() {
    const result = await runtime.listBatches();
    if (!result.ok) { message.error(result.message); return; }
    setHistoryBatches(result.batches || []);
    setHistoryOpen(true);
  }

  async function createNewBatch() {
    const result = await runtime.createBatch({ title: newBatchTitle.trim() || '未命名批次', books: [] });
    if (!result.ok) { message.error(result.message); return; }
    const createdID = createdBatchIdFrom(result.raw);
    setBatchManagerOpen(false);
    setNewBatchTitle('');
    const next = await runtime.load({ ...requestParams, batchId: createdID });
    setRuntimeState(next);
    if (next.phase === 'ready') message.success('新批次已创建');
  }

  return <DirectorRefreshProvider onRefresh={refreshDirectorRevision}>
    <div data-bf-v11-ui="final">
      <BatchFactoryV11Workbench
        batch={viewBatch}
        books={books}
        productionStatus={runtimeState.productionStatus}
        capabilities={capabilities}
        mergeStatus={runtimeState.mergeStatus}
        onOpenBatchManager={() => setBatchManagerOpen(true)}
        onOpenHistory={openHistory}
        onOpenBatchSettings={() => setProductionSettingsOpen(true)}
        onOpenPublishSettings={() => setPublishSettingsOpen(true)}
        onOpenBookSettings={book => setBookSettingsTargetId(book.id)}
        onOpenVideoSettings={(book, video) => setVideoSettingsTarget({ bookId: book.id, videoId: video.id })}
        onRunHook={runHook}
        onApproveHook={approveHook}
        onRunDirector={runDirector}
        onRunBatchDirector={runBatchDirector}
        onPreviewFinalPrompt={previewFinalPrompt}
        onRunProduction={runProduction}
        onRunMerge={runMerge}
        onSaveVideoPrompt={saveVideoPrompt}
        onRefreshAssets={runDirector}
        onSaveAssetPrompts={saveAssetPrompts}
      />

      <Modal title="新建批次" open={batchManagerOpen} onCancel={() => setBatchManagerOpen(false)} onOk={createNewBatch} okText="创建">
        <Input placeholder="批次名称" value={newBatchTitle} onChange={event => setNewBatchTitle(event.target.value)} />
        <Typography.Text type="secondary">创建后可从小说获取导入书目，或在当前批次继续配置。</Typography.Text>
      </Modal>

      <Modal title="历史批次" open={historyOpen} footer={null} onCancel={() => setHistoryOpen(false)}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {(historyBatches || []).map(record => <Button key={record.id} block onClick={async () => { const next = await runtime.load({ ...requestParams, batchId: record.id }); setRuntimeState(next); setHistoryOpen(false); }}>{record.title || record.id} · {record.count || record.books?.length || 0} 本</Button>)}
          {!historyBatches.length ? <Empty description="暂无历史批次" /> : null}
        </Space>
      </Modal>

      <FinalPromptPreviewDrawer
        open={promptPreview.open}
        loading={promptPreview.loading}
        data={promptPreview.data}
        error={promptPreview.error}
        onClose={() => setPromptPreview(current => ({ ...current, open: false }))}
      />

      <ProductionSettingsDrawer
        open={productionSettingsOpen}
        batch={viewBatch}
        configVersions={runtimeState.configVersions || []}
        configVersionsError={runtimeState.configVersionsError || null}
        initialValue={batchSettingsState.patch}
        onClose={() => setProductionSettingsOpen(false)}
        onPreviewChangeImpact={previewBatchChangeImpact}
        onSyncConfigVersion={syncBatchConfigVersion}
        onSaveDraft={saveConstraintDraft}
        onSavePersonalPrompt={savePersonalPrompt}
        onSave={saveBatchSettings}
      />

      <PublishSettingsDrawer
        open={publishSettingsOpen}
        batch={viewBatch}
        initialValue={batchSettingsState.patch.publishSettings || undefined}
        onClose={() => setPublishSettingsOpen(false)}
        onSave={async value => {
          const ok = await saveScope({ scope: 'batch', batchId: batch.id, patch: { publishSettings: value }, revision: batchSettingsState.revision }, '发布统一设置已保存');
          return ok;
        }}
        onSync={async value => {
          await saveScope({ scope: 'batch', batchId: batch.id, patch: { publishSettings: value }, revision: batchSettingsState.revision }, '批量发布配置已同步');
        }}
      />

      <BookSettingsModal
        open={Boolean(activeBook)}
        book={activeBook}
        initialPatch={activeBook?.settingsState?.patch || {}}
        onClose={() => setBookSettingsTargetId('')}
        onSave={saveBookSettings}
      />

      <VideoSettingsDrawer
        open={Boolean(activeVideoBook && activeVideo)}
        book={activeVideoBook}
        video={activeVideo}
        modelMaxDuration={Number(batch.modelMaxDuration || 0)}
        initialPatch={activeVideo?.settingsState?.patch || {}}
        onClose={() => setVideoSettingsTarget(null)}
        onSave={saveVideoSettings}
      />
    </div>
  </DirectorRefreshProvider>;
}

export default BatchFactoryV11UiPage;
