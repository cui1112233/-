import { Alert, Button, Descriptions, Input, InputNumber, Modal, Progress, Select, Space, Tag, message } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { appendNovelFetchIntake, classifyBookPublishMetadata, createNovelFetchIntake, getBatch } from '../../../shared/api/batchFactoryV11';
import { resolveGiantMaterialForBatch } from '../giantMaterialExtractionClient.js';
import { createGiantMaterialJob, waitForGiantMaterialJob } from '../../../shared/api/giantMaterialExecutorPublic.js';
import { BatchFactoryGiantMaterialExecutorStatus } from './BatchFactoryGiantMaterialExecutorStatus.jsx';
import {
  availableGiantMaterialBooks,
  buildGiantMaterialIntake,
  findRegisteredGiantMaterialBook,
  giantMaterialClassificationState,
  giantMaterialBookKey,
  giantMaterialSourceLabel,
  selectGiantMaterialBook
} from './batchFactoryGiantMaterialImport.js';
import { createGiantMaterialQueue, parseGiantMaterialIds, queueSummary, runSequentialGiantMaterialQueue } from './batchFactoryGiantMaterialQueue.js';

const ERROR_MESSAGES = {
  QINGYU_AUTH_NOT_CONFIGURED: '本机尚未配置青语服务令牌。',
  QINGYU_AUTH_FAILED: '青语授权已失效，需要更新令牌。',
  QINGYU_BOOK_METADATA_INCOMPLETE: '素材没有完整的平台书名或 Book ID，不能登记。',
  QINGYU_BOOK_SELECTION_REQUIRED: '该素材关联多条平台书籍记录，请先选择要登记的一条。',
  QINGYU_VIDEO_DURATION_MISSING: '素材没有返回有效的视频时长，暂时不能交给执行器处理。',
  GIANT_OCR_EMPTY: '没有识别到可登记的正文。',
  OCR_NO_TEXT: '没有识别到可登记的正文。',
  OCR_TIMEOUT: '识别超时，可以重试失败步骤。',
  OCR_CANCELLED: '已取消读取，没有写入当前批量。',
  GIANT_EXECUTOR_OFFLINE: 'Windows 巨量素材执行器未安装或未启动，请先安装并完成配对。',
  GIANT_EXECUTOR_FAILED: 'Windows 巨量素材执行器处理失败，可重试失败项。',
  GIANT_EXECUTOR_TIMEOUT: 'Windows 巨量素材执行器超时，任务仍可能在后台运行，请稍后查看状态。',
  BATCH_FACTORY_V11_READ_ONLY: '批量工厂写入接口当前不可用。',
  GIANT_MATERIAL_INTAKE_FAILED: '正文已识别，但批量登记接口没有返回 intake。',
  TEXT_MODEL_REQUIRED: '正文已登记，但当前没有配置可用的文本模型，暂时无法完成 AI 判断。',
  BOOK_CLASSIFICATION_PROVIDER_FAILED: '正文已登记，但文本模型调用失败，暂时无法完成 AI 判断。',
  SOURCE_TEXT_REQUIRED: '正文已登记，但当前书没有可供 AI 判断的正文。'
};

function errorText(error) {
  const code = String(error?.message || error?.code || '').trim();
  return ERROR_MESSAGES[code] || code || '巨量素材登记失败。';
}

function queueTag(item) {
  if (item.status === 'success') return { color: 'green', label: '已登记' };
  if (item.status === 'skipped') return { color: 'gold', label: '已跳过' };
  if (item.status === 'error') return { color: 'red', label: '失败' };
  if (item.status === 'running') return { color: 'blue', label: '读取中' };
  return { color: 'default', label: '待执行' };
}

function queueDetail(item) {
  const classificationStatus = item.classificationStatus || giantMaterialClassificationState(item.registeredBook).status;
  const title = item.registeredBook?.title || item.material?.title || '当前批量';
  if (item.status === 'success') {
    if (classificationStatus === 'classified') return `已写入《${title}》，AI 判断已完成。`;
    if (classificationStatus === 'failed') return `已写入《${title}》，但 AI 判断失败：${item.classificationError || '可在小说详情中重试。'}`;
    return `已写入《${title}》，AI 判断待处理。`;
  }
  if (item.status === 'skipped') {
    if (classificationStatus === 'classified') return '已存在相同巨量素材，未重复登记；AI 判断已完成。';
    if (classificationStatus === 'failed') return `已存在相同巨量素材，未重复登记；AI 判断失败：${item.classificationError || '可在小说详情中重试。'}`;
    return '当前批量已有相同巨量素材 ID，未重复登记。';
  }
  if (item.status === 'error') return ERROR_MESSAGES[item.error] || item.error || '处理失败，可重试。';
  if (item.status === 'running') {
    if (item.stage === 'resolve') return '正在查询青语素材和平台书籍信息…';
    if (item.stage === 'ocr') return '正在由 Windows 巨量素材执行器读取滚屏正文…';
    if (item.stage === 'cleaning') return '正在整理正文…';
    if (item.stage === 'register') return '正在登记正文和来源信息…';
    if (item.stage === 'classify') return '正在 AI 判断男女频、风格和标签…';
    return '正在处理…';
  }
  return '等待顺序读取';
}

export function BatchFactoryGiantMaterialImportModal({ open, batch, onCancel, onImported }) {
  const [giantMaterialInput, setGiantMaterialInput] = useState('');
  const [queue, setQueue] = useState([]);
  const [invalidIds, setInvalidIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [contentRangeLines, setContentRangeLines] = useState(5);
  const [executorHealth, setExecutorHealth] = useState(null);
  const [executorJob, setExecutorJob] = useState(null);
  const controllerRef = useRef(null);
  const queueRef = useRef([]);
  const latestBatchRef = useRef(batch);

  useEffect(() => {
    latestBatchRef.current = batch;
  }, [batch]);

  useEffect(() => {
    if (open) return undefined;
    controllerRef.current?.abort();
    return undefined;
  }, [open]);

  function updateQueue(updater) {
    setQueue(current => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      queueRef.current = next;
      return next;
    });
  }

  function updateItem(id, patch) {
    updateQueue(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  }

  function reset() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    queueRef.current = [];
    setGiantMaterialInput('');
    setQueue([]);
    setInvalidIds([]);
    setBusy(false);
    setContentRangeLines(5);
    setExecutorJob(null);
  }

  function close() {
    if (busy) return;
    onCancel?.();
    reset();
  }

  function selectedBookFor(item) {
    return selectGiantMaterialBook(item.material || {}, item.selectedBookKey);
  }

  function replaceLatestBatchBook(book) {
    if (!book?.id) return;
    const current = latestBatchRef.current || batch;
    if (!current?.id) return;
    const books = Array.isArray(current.books) ? current.books : [];
    const exists = books.some(item => String(item?.id) === String(book.id));
    latestBatchRef.current = {
      ...current,
      books: exists ? books.map(item => String(item?.id) === String(book.id) ? book : item) : [...books, book]
    };
  }

  function batchFromResponse(response) {
    return response?.batch || response?.data?.batch || response?.data || response || null;
  }

  function bookFromResponse(response) {
    return response?.book || response?.data?.book || null;
  }

  async function classifyImportedBook(book, update) {
    if (!book?.id || !batch?.id) return { book, classificationStatus: 'pending', classificationError: '' };
    update({ stage: 'classify', classificationStatus: 'running', classificationError: '' });
    try {
      const response = await classifyBookPublishMetadata(batch.id, book.id, { force: true });
      const classifiedBook = bookFromResponse(response) || book;
      const state = giantMaterialClassificationState(classifiedBook);
      const classificationStatus = state.status === 'pending' && response?.classification ? 'classified' : state.status;
      replaceLatestBatchBook(classifiedBook);
      update({ stage: 'classify', classificationStatus, classificationError: '', registeredBook: classifiedBook, classification: response?.classification || null });
      return { book: classifiedBook, classificationStatus, classificationError: '', classification: response?.classification || null };
    } catch (error) {
      let failedBook = book;
      try {
        const refreshed = batchFromResponse(await getBatch(batch.id));
        const latest = (refreshed?.books || []).find(item => String(item?.id) === String(book.id));
        if (latest) failedBook = latest;
      } catch (_) { /* preserve the actionable original classification error */ }
      const classificationError = errorText(error);
      replaceLatestBatchBook(failedBook);
      update({ stage: 'classify', classificationStatus: 'failed', classificationError, registeredBook: failedBook });
      return { book: failedBook, classificationStatus: 'failed', classificationError };
    }
  }

  async function findAppendedBook(nextBatch, item, selectedBook) {
    let currentBatch = nextBatch;
    let registeredBook = findRegisteredGiantMaterialBook(currentBatch?.books, item.id);
    if (!registeredBook) {
      registeredBook = (currentBatch?.books || []).find(book => String(book?.bookId || '') === String(selectedBook?.platformBookId || selectedBook?.bookId || '')) || null;
    }
    if (!registeredBook) {
      try {
        currentBatch = batchFromResponse(await getBatch(batch?.id));
        registeredBook = findRegisteredGiantMaterialBook(currentBatch?.books, item.id)
          || (currentBatch?.books || []).find(book => String(book?.bookId || '') === String(selectedBook?.platformBookId || selectedBook?.bookId || ''))
          || null;
      } catch (_) { /* registration itself already succeeded; leave the book visible after refresh */ }
    }
    if (currentBatch?.id) latestBatchRef.current = currentBatch;
    return registeredBook;
  }

  async function processItem(item, { signal, update }) {
    const existing = findRegisteredGiantMaterialBook(latestBatchRef.current?.books, item.id);
    if (existing) {
      const existingState = giantMaterialClassificationState(existing);
      if (existingState.status === 'classified') return { status: 'skipped', registeredBook: existing, classificationStatus: existingState.status };
      const classification = await classifyImportedBook(existing, update);
      return { status: 'skipped', registeredBook: classification.book || existing, classificationStatus: classification.classificationStatus, classificationError: classification.classificationError };
    }

    update({ stage: 'resolve', error: '' });
    const resolvedMaterial = await resolveGiantMaterialForBatch(item.id, { signal });
    const books = availableGiantMaterialBooks(resolvedMaterial);
    const selectedBookKey = item.selectedBookKey || (books.length === 1 ? giantMaterialBookKey(books[0]) : '');
    update({ stage: 'resolve', material: resolvedMaterial, books, selectedBookKey });
    if (!books.length) throw new Error('QINGYU_BOOK_METADATA_INCOMPLETE');
    if (!selectedBookKey) throw new Error('QINGYU_BOOK_SELECTION_REQUIRED');

    if (executorHealth?.online !== true) throw new Error('GIANT_EXECUTOR_OFFLINE');
    const selectedBook = selectGiantMaterialBook(resolvedMaterial, selectedBookKey);
    if (!selectedBook) throw new Error('QINGYU_BOOK_SELECTION_REQUIRED');
    const durationSeconds = Number(resolvedMaterial.durationSeconds || resolvedMaterial.duration || 0);
    if (!(durationSeconds > 0)) throw new Error('QINGYU_VIDEO_DURATION_MISSING');
    update({ stage: 'ocr', progress: { seconds: 0, durationSeconds, frames: 0, characters: 0 } });
    const createdResponse = await createGiantMaterialJob({
      materialId: item.id,
      platformBookId: selectedBook.platformBookId || selectedBook.bookId,
      title: selectedBook.title,
      videoUrl: resolvedMaterial.videoUrl,
      durationSeconds,
      modelVersion: 'windows-paddleocr-v1',
      contentRangeLines
    });
    const createdJob = createdResponse?.job || createdResponse?.data?.job || createdResponse;
    if (!createdJob?.id) throw new Error('GIANT_EXECUTOR_FAILED');
    setExecutorJob(createdJob);
    const completedJob = await waitForGiantMaterialJob(createdJob.id, {
      signal,
      onState: next => {
        setExecutorJob(next);
        update({
          stage: String(next?.state || '').toLowerCase() === 'cleaning' ? 'cleaning' : 'ocr',
          progress: next?.progress || null
        });
      }
    });
    if (String(completedJob?.state || '').toLowerCase() !== 'succeeded' || !String(completedJob?.result?.text || '').trim()) {
      throw new Error(completedJob?.errorCode || 'GIANT_EXECUTOR_FAILED');
    }
    const extracted = {
      ...completedJob.result,
      sourceCompleteness: 'video_excerpt',
      requiresProofreading: true
    };

    update({ stage: 'register', result: extracted });
    const material = resolvedMaterial || item.material || {};
    const intakePayload = buildGiantMaterialIntake({ giantMaterialId: item.id, material, extraction: extracted, book: selectedBook, contentRangeLines });
    const intakeResponse = await createNovelFetchIntake(intakePayload);
    const intake = intakeResponse?.intake || intakeResponse;
    if (!intake?.id) throw new Error('GIANT_MATERIAL_INTAKE_FAILED');
    const appended = await appendNovelFetchIntake(latestBatchRef.current?.id || batch?.id, intake.id, { allowDuplicate: false });
    const nextBatch = appended?.batch || appended;
    if (nextBatch?.id) latestBatchRef.current = nextBatch;
    const registeredBook = await findAppendedBook(nextBatch, item, selectedBook);
    const classification = registeredBook ? await classifyImportedBook(registeredBook, update) : { classificationStatus: 'pending', classificationError: '' };
    return { material, result: extracted, selectedBookKey: giantMaterialBookKey(selectedBook), registeredBook: classification.book || registeredBook || selectedBook, batch: latestBatchRef.current || nextBatch, classificationStatus: classification.classificationStatus, classificationError: classification.classificationError };
  }

  async function executeQueue(items) {
    if (busy || !items.length || !batch?.id) return;
    setBusy(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    let completed = [];
    try {
      completed = await runSequentialGiantMaterialQueue(items, processItem, {
        signal: controller.signal,
        onState: (item, patch) => updateItem(item.id, patch)
      });
      const summary = queueSummary(completed);
      if (summary.error) {
        message.warning(`已处理 ${summary.success + summary.skipped} / ${summary.total} 条；失败项可以单独重试。`);
      } else if (summary.success || summary.skipped) {
        message.success(`已顺序处理 ${summary.success} 条，跳过 ${summary.skipped} 条重复素材。`);
        await onImported?.(latestBatchRef.current);
      }
    } catch (error) {
      if (!controller.signal.aborted) message.error(errorText(error));
    } finally {
      controllerRef.current = null;
      setBusy(false);
      queueRef.current = completed.length ? completed : queueRef.current;
      setQueue(current => {
        const next = completed.length ? [...completed] : current;
        if (controller.signal.aborted) {
          for (const item of next) {
            if (item.status === 'running') Object.assign(item, { status: 'error', stage: 'error', error: 'OCR_CANCELLED' });
          }
        }
        queueRef.current = next;
        return next;
      });
    }
  }

  function startQueue() {
    if (busy || !batch?.id) return;
    const parsed = parseGiantMaterialIds(giantMaterialInput);
    setInvalidIds(parsed.invalid);
    if (!parsed.valid.length) {
      message.warning('请输入至少一条 10—25 位数字巨量素材 ID。');
      return;
    }
    const items = createGiantMaterialQueue(parsed.valid);
    queueRef.current = items;
    setQueue(items);
    executeQueue(items);
  }

  function retryItem(id) {
    if (busy) return;
    const item = queueRef.current.find(entry => entry.id === id && entry.status === 'error');
    if (!item) return;
    const retry = { ...item, status: 'pending', stage: 'idle', error: '', progress: null, result: null, classificationStatus: '', classificationError: '', classification: null };
    const next = queueRef.current.map(entry => entry.id === id ? retry : entry);
    queueRef.current = next;
    setQueue(next);
    executeQueue(next.filter(entry => entry.id === id));
  }

  function retryFailed() {
    if (busy) return;
    const failed = queueRef.current.filter(item => item.status === 'error').map(item => ({ ...item, status: 'pending', stage: 'idle', error: '', progress: null, result: null, classificationStatus: '', classificationError: '', classification: null }));
    if (!failed.length) return;
    const failedById = new Map(failed.map(item => [item.id, item]));
    const next = queueRef.current.map(item => failedById.get(item.id) || item);
    queueRef.current = next;
    setQueue(next);
    executeQueue(failed);
  }

  function chooseBook(id, value) {
    updateItem(id, { selectedBookKey: value, error: '' });
  }

  const summary = queueSummary(queue);
  const inputPreview = useMemo(() => parseGiantMaterialIds(giantMaterialInput), [giantMaterialInput]);
  const canStart = Boolean(batch?.id) && !busy && inputPreview.valid.length > 0;

  return <Modal
    title="巨量素材获取"
    open={open}
    onCancel={close}
    destroyOnClose
    width={760}
    footer={<Space wrap><Button onClick={close} disabled={busy}>关闭</Button>{busy ? <Button danger onClick={() => controllerRef.current?.abort()}>取消读取</Button> : null}<Button onClick={retryFailed} disabled={busy || !summary.error}>重试失败项</Button><Button type="primary" onClick={startQueue} loading={busy} disabled={!canStart}>{busy ? '顺序读取中…' : '开始读取并登记'}</Button></Space>}
  >
    <BatchFactoryGiantMaterialExecutorStatus job={executorJob} onHealthChange={setExecutorHealth} />
    <Alert type="info" showIcon message="支持批量巨量素材 ID" description="每行或用逗号分隔一条 ID。系统会顺序读取，成功后登记到当前批量；重复 ID 自动跳过，不保存 MP4 或抽帧文件。" />
    <label className="shuihuo-form-label" htmlFor="batch-giant-material-id">巨量素材 ID（可多条）</label>
    <Input.TextArea id="batch-giant-material-id" value={giantMaterialInput} disabled={busy} onChange={event => setGiantMaterialInput(event.target.value)} rows={5} placeholder="例如：\n7689285397448523826\n7613606077155459091" />
    {invalidIds.length ? <Alert style={{ marginTop: 10 }} type="warning" showIcon message="已忽略格式不正确的内容" description={invalidIds.join('、')} /> : null}
    {!batch?.id ? <Alert style={{ marginTop: 10 }} type="error" showIcon message="当前批量不可写入" description="请先打开一个有效的批量工厂批量。" /> : null}
    {queue.length ? <Alert style={{ marginTop: 14 }} type={summary.error ? 'warning' : summary.success + summary.skipped === summary.total ? 'success' : 'info'} showIcon message={`队列状态：${summary.success} 已登记 · ${summary.skipped} 已跳过 · ${summary.error} 失败 · ${summary.pending + summary.running} 待处理`} description="处理严格按输入顺序执行；失败项不会阻塞其它 ID。" /> : null}
    <label className="shuihuo-form-label">内容范围<InputNumber min={1} max={500} value={contentRangeLines} onChange={value => setContentRangeLines(value || 5)} addonAfter="行" disabled={busy} /></label>
    <Space direction="vertical" size={10} style={{ width: '100%', marginTop: 12 }}>
      {queue.map(item => {
        const tag = queueTag(item);
        const books = item.books || [];
        const selectedBook = selectedBookFor(item);
        const progressPercent = item.progress?.durationSeconds > 0 ? Math.min(100, Math.round((Number(item.progress.seconds || 0) / item.progress.durationSeconds) * 100)) : 0;
        return <div key={item.id} style={{ border: '1px solid #27384a', borderRadius: 8, padding: 12 }}>
          <Space wrap><Tag color={tag.color}>{tag.label}</Tag><code>{item.id}</code><span>{queueDetail(item)}</span></Space>
          {item.status === 'running' && progressPercent > 0 ? <Progress percent={progressPercent} size="small" status="active" /> : null}
          {books.length > 1 ? <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 8 }}><span>该素材关联多条平台书籍，请选择登记对象：</span><Select style={{ width: '100%' }} value={item.selectedBookKey || undefined} onChange={value => chooseBook(item.id, value)} disabled={busy} placeholder="选择平台书籍" options={books.map(book => ({ value: giantMaterialBookKey(book), label: `${book.title} · ${book.platformName || '书城'} · ${book.platformBookId}` }))} /></Space> : null}
          {selectedBook && item.material ? <Descriptions size="small" bordered column={1} style={{ marginTop: 8 }} items={[{ key: 'book', label: '登记书籍', children: `${selectedBook.title} · ${selectedBook.platformName || '书城未返回'} · ${selectedBook.platformBookId}` }, { key: 'source', label: '来源', children: giantMaterialSourceLabel(item.id) }]} /> : null}
          {item.status === 'error' ? <Space style={{ marginTop: 8 }}><span style={{ color: '#ff8f8f' }}>{ERROR_MESSAGES[item.error] || item.error}</span><Button size="small" onClick={() => retryItem(item.id)} disabled={busy}>重试此项</Button></Space> : null}
        </div>;
      })}
    </Space>
  </Modal>;
}
