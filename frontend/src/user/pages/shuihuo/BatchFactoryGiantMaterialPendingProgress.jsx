import { useEffect, useRef, useState } from 'react';
import { Progress } from 'antd';
import { getGiantMaterialJob } from '../../../shared/api/giantMaterialExecutorPublic.js';
import { updateBookSource } from '../../../shared/api/batchFactoryV11.js';

// 占位书正文进度条：巨量素材登记后正文为空，Windows 执行器读取期间在书卡“小说正文”位置
// 显示实时进度（视频 x/y 秒 + 百分比）。读取完成后在这里直接回填正文并刷新，弹窗关了也不丢。
export function BatchFactoryGiantMaterialPendingProgress({ book, batchId, onContentReady }) {
  const metadata = book?.sourceMetadata || {};
  const jobId = String(metadata.executorJobId || '').trim();
  const pending = Boolean(metadata.contentPending);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
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
              const nextMetadata = { ...metadata, sourceCompleteness: 'video_excerpt', requiresProofreading: true };
              delete nextMetadata.contentPending;
              try {
                await updateBookSource(batchId, book.id, {
                  sourceText: body,
                  sourceMetadata: nextMetadata,
                  expectedRevision: Number(book.revision || 0)
                });
              } catch (_) { /* 多半是弹窗那边已回填；冲突时以已写入的为准 */ }
            }
            onContentReady?.();
          }
          return;
        }
        if (state === 'failed' || state === 'cancelled') {
          setError(state === 'cancelled' ? '正文读取已取消，可用同一个巨量素材 ID 重新登记重试。' : '正文读取失败，可用同一个巨量素材 ID 重新登记重试。');
          return;
        }
        setProgress(job.progress || null);
      } catch (_) { /* 网络抖动下一轮再试 */ }
    };
    tick();
    const timer = setInterval(tick, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [jobId, pending, batchId]);

  if (!pending) return null;
  if (error) return <div className="batch-factory-giant-pending is-error"><span>{error}</span></div>;
  const percent = Math.max(0, Math.min(100, Number(progress?.percent || 0)));
  const seconds = progress?.total ? ` · 视频 ${progress.completed || 0}/${progress.total} 秒` : '';
  return <div className="batch-factory-giant-pending" onClick={event => event.stopPropagation()}>
    <Progress percent={percent} size="small" status="active" />
    <span>{percent > 0 ? `正在读取正文 ${percent}%${seconds}` : '正在排队读取正文…'}</span>
  </div>;
}
