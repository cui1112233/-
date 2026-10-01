import { useEffect, useRef, useState } from 'react';
import { Alert, Button, message, Progress, Space, Tooltip } from 'antd';
import { classifyBookPublishMetadata, fetchBookOriginal, getBatch, getBatchAutomationStatus, startBatchAutomation, updateBookMetadata, updateBookSource } from '../../../shared/api/batchFactoryV11.js';
import { findRegisteredGiantMaterialBook } from './batchFactoryGiantMaterialImport.js';
import { createGiantMaterialJob, getGiantMaterialJob } from '../../../shared/api/giantMaterialExecutorPublic.js';

// 旧批量在浏览器页面里创建，可能已经留下“direct_first + 待读取”的占位书。
// 同一页面只允许一条直取请求在飞行，避免一次打开 20 本书把书城接口打爆。
let directFirstReadTail = Promise.resolve();
const giantAutomationStartClaims = new Set();
function enqueueDirectFirstRead(task) {
  const next = directFirstReadTail.then(task, task);
  directFirstReadTail = next.catch(() => undefined);
  return next;
}

async function startSavedGiantAutomation(batchId, plan) {
  if (!batchId || !plan?.presetId) return { started: false };
  // 同批多本书可能在相邻秒数里完成 OCR；只允许其中一条回填继续启动生产。
  // 生产控制器的 start 会替换已有任务，因此这里既要本页去重，也要先看服务端真实状态。
  if (giantAutomationStartClaims.has(batchId)) return { started: false };
  giantAutomationStartClaims.add(batchId);
  try {
    const statusResponse = await getBatchAutomationStatus(batchId);
    const automation = statusResponse?.automation || statusResponse?.data?.automation || statusResponse?.data || statusResponse || {};
    if (['running', 'scheduled', 'paused'].includes(String(automation.state || '').toLowerCase())) return { started: false };
    await startBatchAutomation(batchId, {
      scheduledAt: plan.scheduledAt || '',
      presetId: plan.presetId,
      runMode: plan.runMode || 'video_no_submit',
      autoPublish: plan.autoPublish === true,
      concurrency: plan.concurrency
    });
    return { started: true, scheduled: Boolean(plan.scheduledAt) };
  } catch (error) {
    giantAutomationStartClaims.delete(batchId);
    throw error;
  }
}

// 占位书正文进度条：巨量素材登记后正文为空，Windows 执行器读取期间在书卡“小说正文”位置
// 显示实时进度（视频 x/y 秒 + 百分比）。读取完成后在这里直接回填正文并刷新，弹窗关了也不丢。
// 读取失败或未绑定任务时提供“原文获取”：用书卡已有的书名 + Book ID + 书城直接拉正文兜底。
export function BatchFactoryGiantMaterialPendingProgress({ book, batchId, onContentReady, visible = true }) {
  const metadata = book?.sourceMetadata || {};
  const jobId = String(metadata.executorJobId || '').trim();
  const pending = Boolean(metadata.contentPending);
  const originalReadStrategy = String(metadata.originalReadStrategy || 'ocr_first');
  const persistedOriginalReadError = String(metadata.originalReadError || '').trim();
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [refetching, setRefetching] = useState(false);
  const [ocrStarting, setOcrStarting] = useState(false);
  const doneRef = useRef(false);
  const fallbackRef = useRef('');
  const autoStartRef = useRef('');

  useEffect(() => {
    doneRef.current = false;
    setError('');
    setProgress(null);
    if (!pending || !jobId || !batchId) return undefined;
    let stopped = false;
    const tick = async () => {
      try {
        const response = await getGiantMaterialJob(jobId);
        const job = response?.job || response?.data?.job || response;
        if (stopped || !job) return;
        const state = String(job.state || '').toLowerCase();
        if (state === 'succeeded') {
          setProgress({ completed: 100, total: 100, percent: 100 });
          if (!doneRef.current) {
            doneRef.current = true;
            const body = String(job.result?.text || '').trim();
            if (body) {
              try {
                // 刷新后再写，避免和创建时的 AI 分类/其它弹窗更新抢同一个 revision。
                const latestResponse = await getBatch(batchId);
                const latestBatch = latestResponse?.batch || latestResponse?.data?.batch || latestResponse?.data || latestResponse;
                const latestBook = findRegisteredGiantMaterialBook(latestBatch?.books, metadata.giantMaterialId) || (latestBatch?.books || []).find(item => item?.id === book.id);
                if (!latestBook?.id) throw new Error('GIANT_MATERIAL_BOOK_NOT_FOUND');
                if (String(latestBook.sourceText || '').trim()) {
                  onContentReady?.();
                  return;
                }
                const nextMetadata = {
                  ...(latestBook.sourceMetadata || {}),
                  sourceCompleteness: 'video_excerpt',
                  requiresProofreading: true,
                  giantOcrState: 'succeeded',
                  giantOcrCompletedAt: new Date().toISOString(),
                  giantOcrCharacters: body.length,
                  originalReadStage: 'completed',
                  originalReadVia: 'ocr',
                  originalReadError: '',
                  contentPending: false
                };
                await updateBookSource(batchId, latestBook.id, {
                  sourceText: body,
                  sourceMetadata: nextMetadata,
                  expectedRevision: Number(latestBook.revision || 0)
                });
                // 回填后补一次 AI 判断：新建批量弹窗派发的书没有弹窗帮它分类。
                try { await classifyBookPublishMetadata(batchId, latestBook.id, { force: true }); } catch (_) { /* 分类失败不阻断生产，可单书重试 */ }
                const plan = nextMetadata.giantAutomationPlan;
                if (plan?.presetId) {
                  try {
                    const result = await startSavedGiantAutomation(batchId, plan);
                    if (result.started) message.success(result.scheduled ? '正文已回填，自动生产已进入定时队列。' : '正文已回填，已继续自动生产。');
                  } catch (automationError) {
                    message.warning(`正文已回填；自动生产请在工作区重试：${automationError?.message || '启动失败'}`);
                  }
                }
              } catch (syncError) {
                setError(String(syncError?.message || '正文已识别，但回填失败；请刷新后重试。'));
              }
            }
            onContentReady?.();
          }
          return;
        }
        if (state === 'failed' || state === 'cancelled') {
          const failure = state === 'cancelled' ? '正文读取已取消。' : '正文读取失败。';
          if (originalReadStrategy === 'ocr_first' && fallbackRef.current !== jobId) {
            fallbackRef.current = jobId;
            setError(`${failure} 正在自动改用书城获取正文…`);
            refetchOriginal(true);
            return;
          }
          setError(failure);
          return;
        }
        setProgress(job.progress || null);
      } catch (_) { /* 网络抖动下一轮再试 */ }
    };
    tick();
    const timer = setInterval(tick, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [jobId, pending, batchId, originalReadStrategy]);

  async function refetchOriginal(automatic = false) {
    if (!batchId || !book?.id || refetching) return;
    setRefetching(true);
    try {
      const latestResponse = await getBatch(batchId);
      const latestBatch = latestResponse?.batch || latestResponse?.data?.batch || latestResponse?.data || latestResponse;
      const latestBook = findRegisteredGiantMaterialBook(latestBatch?.books, metadata.giantMaterialId) || (latestBatch?.books || []).find(item => item?.id === book.id);
      if (!latestBook?.id) throw new Error('GIANT_MATERIAL_BOOK_NOT_FOUND');
      if (String(latestBook.sourceText || '').trim()) {
        onContentReady?.();
        return;
      }
      await updateBookMetadata(batchId, latestBook.id, {
        metadata: { ...(latestBook.sourceMetadata || {}), originalReadStage: 'direct', originalReadError: '', contentPending: true },
        expectedRevision: Number(latestBook.revision || 0)
      });
      await fetchBookOriginal(batchId, latestBook.id);
      try { await classifyBookPublishMetadata(batchId, latestBook.id, { force: true }); } catch (_) { /* 分类失败不阻断生产，可单书重试 */ }
      const plan = latestBook.sourceMetadata?.giantAutomationPlan;
      if (plan?.presetId) {
        try {
          await startSavedGiantAutomation(batchId, plan);
        } catch (automationError) {
          message.warning(`正文已回填；自动生产请在工作区重试：${automationError?.message || '启动失败'}`);
        }
      }
      message.success('已通过书城获取正文');
      onContentReady?.();
    } catch (fetchError) {
      const failure = String(fetchError?.message || '获取正文失败');
      try {
        const refreshedResponse = await getBatch(batchId);
        const refreshedBatch = refreshedResponse?.batch || refreshedResponse?.data?.batch || refreshedResponse?.data || refreshedResponse;
        const refreshedBook = findRegisteredGiantMaterialBook(refreshedBatch?.books, metadata.giantMaterialId) || (refreshedBatch?.books || []).find(item => item?.id === book.id);
        if (refreshedBook?.id) {
          await updateBookMetadata(batchId, refreshedBook.id, {
            metadata: { ...(refreshedBook.sourceMetadata || {}), originalReadStage: 'failed', originalReadError: failure, contentPending: true },
            expectedRevision: Number(refreshedBook.revision || 0)
          });
        }
      } catch (_) { /* 原错误优先展示；用户仍可手动重试 */ }
      if (automatic && originalReadStrategy === 'direct_first') {
        setError('原始书城读取失败，正在自动改用滚屏 OCR…');
        await startOcrFallback();
        return;
      }
      setError(failure);
      if (!automatic) message.error(failure);
    } finally {
      setRefetching(false);
    }
  }

  async function startOcrFallback() {
    if (!batchId || !book?.id) return;
    setOcrStarting(true);
    try {
      // 读取最新 revision，避免“直接获取原文”失败后再次派发 OCR 时覆盖其它书卡更新。
      const latestResponse = await getBatch(batchId);
      const latestBatch = latestResponse?.batch || latestResponse?.data?.batch || latestResponse?.data || latestResponse;
      const latestBook = findRegisteredGiantMaterialBook(latestBatch?.books, metadata.giantMaterialId) || (latestBatch?.books || []).find(item => item?.id === book.id);
      if (!latestBook?.id) throw new Error('GIANT_MATERIAL_BOOK_NOT_FOUND');
      if (String(latestBook.sourceText || '').trim()) {
        onContentReady?.();
        return;
      }
      const latestMetadata = latestBook.sourceMetadata || metadata;
      const durationSeconds = Number(latestMetadata.videoDurationSeconds || 0);
      if (!(durationSeconds > 0)) throw new Error('素材缺少有效视频时长，无法改用滚屏 OCR。');
      const job = await createGiantMaterialJob({ materialId: latestMetadata.giantMaterialId, platformBookId: latestMetadata.platformBookId, title: latestMetadata.sourceBookTitle || latestBook.title, videoUrl: latestMetadata.videoUrl, durationSeconds, contentRangeLines: latestMetadata.contentRangeLines });
      const created = job?.job || job?.data?.job || job;
      if (!created?.id) throw new Error('GIANT_EXECUTOR_FAILED');
      await updateBookMetadata(batchId, latestBook.id, {
        metadata: { ...latestMetadata, executorJobId: created.id, originalReadStage: 'ocr', originalReadError: '', contentPending: true },
        expectedRevision: Number(latestBook.revision || 0)
      });
      setError(''); onContentReady?.();
    } catch (startError) { setError(String(startError?.message || '等待执行器')); } finally { setOcrStarting(false); }
  }

  useEffect(() => {
    const key = `${book?.id || ''}:${book?.revision || 0}`;
    const shouldResume = Boolean(
      visible
      && pending
      && batchId
      && book?.id
      && !jobId
      && !String(book?.sourceText || '').trim()
      && !persistedOriginalReadError
      && originalReadStrategy === 'direct_first'
    );
    if (!shouldResume || autoStartRef.current === key) return;
    autoStartRef.current = key;
    enqueueDirectFirstRead(() => refetchOriginal(true));
  }, [visible, pending, batchId, book?.id, book?.revision, book?.sourceText, jobId, persistedOriginalReadError, originalReadStrategy]);

  if (!pending || !visible) return null;
  if (error || persistedOriginalReadError || !jobId) {
    // 窄列（小说列表弹窗“内容”格）放不下整块 Alert：错误全文进悬浮提示，行内只留
    // 一行红字 + 竖排两个恢复按钮，避免文字/按钮被挤断行。
    const detail = String(error || persistedOriginalReadError || 'OCR 任务未派发');
    return (
      <Tooltip title={detail}>
        <span className="batch-factory-giant-pending-compact" onClick={event => event.stopPropagation()}>
          <i className="is-error-text">{error || persistedOriginalReadError ? '读取失败' : '未派发OCR'}</i>
          <Space direction="vertical" size={4} className="is-actions">
            <Button size="small" type="primary" loading={refetching} onClick={() => refetchOriginal(false)}>重试获取原文</Button>
            <Button size="small" loading={ocrStarting} disabled={refetching} onClick={startOcrFallback}>改用滚屏 OCR</Button>
          </Space>
        </span>
      </Tooltip>
    );
  }
  const percent = Math.max(0, Math.min(100, Number(progress?.percent || 0)));
  const seconds = progress?.total ? ` · 视频 ${progress.completed || 0}/${progress.total} 秒` : '';
  const detail = percent > 0 ? `正在读取正文 ${percent}%${seconds}` : '正在排队读取正文…';
  return <Alert className="batch-factory-giant-pending" type="info" showIcon message="滚屏 OCR" description={<><Progress percent={percent} size="small" status="active" /><span>{detail}</span></>} onClick={event => event.stopPropagation()} />;
}
