import { Alert, Button, Empty, Space, Spin, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as batchFactoryV11 from '../../../shared/api/batchFactoryV11.js';
import { BatchFactoryV11Workbench } from './BatchFactoryV11Workbench';
import { ProductionSettingsDrawer } from './BatchFactoryV11SettingsDrawers';
import { BookSettingsModal, VideoSettingsDrawer } from './BatchFactoryV11ScopedSettings';
import { DirectorRefreshProvider } from './DirectorRefreshContext.jsx';
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
  const batchSettingsRevision = Number(batchSettingsState.revision || batch?.revision || 0);
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
      revision: batchSettingsRevision
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
      revision: batchSettingsRevision
    }, '生产统一设置已保存');
  }

  async function syncBatchConfigVersion(configVersion) {
    if (!configVersion) return false;
    const result = await runtime.save({
      scope: 'batch',
      batchId: batch.id,
      patch: { configVersion },
      revision: batchSettingsRevision
    });
    if (!result.ok) {
      message.error(result.message);
      return false;
    }
    setRuntimeState(current => {
      if (current.phase !== 'ready' || !current.batch || current.batch.id !== batch.id) return current;
      return {
        ...current,
        batch: {
          ...current.batch,
          settingsState: result.state
        }
      };
    });
    message.success('批量后台配置版本已同步');
    return true;
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

  return <DirectorRefreshProvider onRefresh={refreshDirectorRevision}>
    <div data-bf-v11-ui="final">
      <BatchFactoryV11Workbench
        batch={viewBatch}
        books={books}
        capabilities={capabilities}
        onOpenBatchSettings={() => setProductionSettingsOpen(true)}
        onOpenBookSettings={book => setBookSettingsTargetId(book.id)}
        onOpenVideoSettings={(book, video) => setVideoSettingsTarget({ bookId: book.id, videoId: video.id })}
      />

      <ProductionSettingsDrawer
        open={productionSettingsOpen}
        batch={viewBatch}
        initialValue={batchSettingsState.patch}
        configVersions={runtimeState.configVersions}
        latestConfigVersion={runtimeState.latestConfigVersion}
        configVersionsError={runtimeState.configVersionsError}
        onClose={() => setProductionSettingsOpen(false)}
        onPreviewChangeImpact={previewBatchChangeImpact}
        onSyncConfigVersion={syncBatchConfigVersion}
        onSave={saveBatchSettings}
      />

      <BookSettingsModal
        open={Boolean(activeBook)}
        book={activeBook}
        configVersions={runtimeState.configVersions}
        configVersionsError={runtimeState.configVersionsError}
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
