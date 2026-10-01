import { useEffect, useRef, useState } from 'react';
import { Alert, Button, message, Progress } from 'antd';
import { classifyBookPublishMetadata, fetchBookOriginal, getBatch, startBatchAutomation, updateBookSource } from '../../../shared/api/batchFactoryV11.js';
import { findRegisteredGiantMaterialBook } from './batchFactoryGiantMaterialImport.js';
import { getGiantMaterialJob } from '../../../shared/api/giantMaterialExecutorPublic.js';

// 占位书正文进度条：巨量素材登记后正文为空，Windows 执行器读取期间在书卡“小说正文”位置
// 显示实时进度（视频 x/y 秒 + 百分比）。读取完成后在这里直接回填正文并刷新，弹窗关了也不丢。
// 读取失败或未绑定任务时提供“原文获取”：用书卡已有的书名 + Book ID + 书城直接拉正文兜底。
export function BatchFactoryGiantMaterialPendingProgress({ book, batchId, onContentReady, visible = true }) {
  const metadata = book?.sourceMetadata || {};
  const jobId = String(metadata.executorJobId || '').trim();
  const pending = Boolean(metadata.contentPending);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [refetching, setRefetching] = useState(false);
  const doneRef = useRef(false);

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
                  giantOcrCharacters: body.length
                };
                delete nextMetadata.contentPending;
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
                    await startBatchAutomation(batchId, {
                      scheduledAt: plan.scheduledAt || '',
                      presetId: plan.presetId,
                      runMode: plan.runMode || 'video_no_submit',
                      autoPublish: plan.autoPublish === true,
                      concurrency: plan.concurrency
                    });
                    message.success(plan.scheduledAt ? '正文已回填，自动生产已进入定时队列。' : '正文已回填，已继续自动生产。');
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
          setError(state === 'cancelled' ? '正文读取已取消。' : '正文读取失败。');
          return;
        }
        setProgress(job.progress || null);
      } catch (_) { /* 网络抖动下一轮再试 */ }
    };
    tick();
    const timer = setInterval(tick, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [jobId, pending, batchId]);

  async function refetchOriginal() {
    if (!batchId || !book?.id || refetching) return;
    setRefetching(true);
    try {
      await fetchBookOriginal(batchId, book.id);
      try { await classifyBookPublishMetadata(batchId, book.id, { force: true }); } catch (_) { /* 分类失败不阻断生产，可单书重试 */ }
      message.success('已通过书城获取正文');
      onContentReady?.();
    } catch (fetchError) {
      message.error(String(fetchError?.message || '获取正文失败'));
    } finally {
      setRefetching(false);
    }
  }

  if (!pending || !visible) return null;
  if (error || !jobId) return <Alert className="batch-factory-giant-pending is-error" type="error" showIcon message={error || '未绑定读取任务'} description={<Button size="small" type="primary" loading={refetching} onClick={refetchOriginal}>原文获取</Button>} onClick={event => event.stopPropagation()} />;
  const percent = Math.max(0, Math.min(100, Number(progress?.percent || 0)));
  const seconds = progress?.total ? ` · 视频 ${progress.completed || 0}/${progress.total} 秒` : '';
  const detail = percent > 0 ? `正在读取正文 ${percent}%${seconds}` : '正在排队读取正文…';
  return <Alert className="batch-factory-giant-pending" type="info" showIcon message="滚屏 OCR" description={<><Progress percent={percent} size="small" status="active" /><span>{detail}</span></>} onClick={event => event.stopPropagation()} />;
}
