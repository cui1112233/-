import { Button, Checkbox, Space, Typography } from 'antd';
import { Copy, Download, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getScriptVideoTask } from '../../shared/api/scriptVideo';
import { splitShotTextHighlight } from './shotTextHighlight';
import { getShotMatchDisplayRange } from '../pages/scriptShotReplace';

const LOCAL_EXECUTOR_STAGE_LABELS = {
  queued: '已提交 · 等待执行器',
  leased: '执行器已接单 · 正在准备',
  preparing: '执行器已接单 · 正在准备豆包',
  submitting: '正在提交豆包',
  acceptance_unknown: '豆包状态待确认 · 正在安全确认',
  accepted: '豆包已接单 · 准备生成',
  generating: '豆包已接单 · 正在生成',
  downloading: '正在下载视频',
  uploading: '正在回传网站'
};

function taskStatusText(task, submitting, submissionError) {
  if (submitting) return '正在提交视频任务…';
  if (submissionError) return `生成失败：${submissionError}`;
  if (!task) return '';
  if (task.status === 'succeeded') return '视频已完成';
  if (task.status === 'failed') return `生成失败：${task.error || '视频任务失败'}`;
  if (task.status === 'processing') {
    const stage = String(task.executorState || '').trim().toLowerCase();
    if (LOCAL_EXECUTOR_STAGE_LABELS[stage]) return LOCAL_EXECUTOR_STAGE_LABELS[stage];
    if (String(task.taskId || '').startsWith('lej_')) return '已提交 · 等待执行器';
    return '视频生成中';
  }
  return '';
}

export function ShotOutputCards({ cards, duration, selectedIndexes, onToggle, onToggleAll, onCopy, onCopySelected, onGenerateVideo, generatingIndexes = new Set(), videoTasks = {}, onOpenVideo, output, activeMatch, cardStarts }) {
  const selectedCount = selectedIndexes.size;
  const allSelected = cards.length > 0 && selectedCount === cards.length;
  const activeMatchRef = useRef(null);
  const previousGeneratingRef = useRef(new Set());
  const attemptTaskIdsRef = useRef({});
  const [liveVideoTasks, setLiveVideoTasks] = useState({});
  const [submissionErrors, setSubmissionErrors] = useState({});

  useEffect(() => {
    activeMatchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }, [activeMatch]);

  useEffect(() => {
    const previous = previousGeneratingRef.current;
    setSubmissionErrors(current => {
      const next = { ...current };
      let changed = false;

      for (const index of generatingIndexes) {
        if (!previous.has(index)) attemptTaskIdsRef.current[index] = videoTasks[index]?.taskId || '';
        if (next[index]) {
          delete next[index];
          changed = true;
        }
      }

      for (const index of previous) {
        if (generatingIndexes.has(index)) continue;
        const beforeTaskId = attemptTaskIdsRef.current[index] || '';
        const afterTaskId = videoTasks[index]?.taskId || '';
        if (!afterTaskId || afterTaskId === beforeTaskId) {
          const errorText = '视频任务提交未成功，请重试';
          if (next[index] !== errorText) {
            next[index] = errorText;
            changed = true;
          }
        } else if (next[index]) {
          delete next[index];
          changed = true;
        }
        delete attemptTaskIdsRef.current[index];
      }

      return changed ? next : current;
    });
    previousGeneratingRef.current = new Set(generatingIndexes);
  }, [generatingIndexes, videoTasks]);

  useEffect(() => {
    let cancelled = false;
    const timers = new Set();

    const schedule = (index, parentTask, delayMs) => {
      const timer = setTimeout(async () => {
        timers.delete(timer);
        if (cancelled) return;
        try {
          const task = await getScriptVideoTask(parentTask.taskId);
          if (cancelled) return;
          setLiveVideoTasks(current => ({ ...current, [index]: task }));
          if (task?.status === 'processing') schedule(index, parentTask, 2000);
        } catch {
          if (!cancelled) schedule(index, parentTask, 3000);
        }
      }, delayMs);
      timers.add(timer);
    };

    Object.entries(videoTasks).forEach(([key, parentTask]) => {
      if (!parentTask?.taskId || parentTask.status !== 'processing') return;
      schedule(Number(key), parentTask, 0);
    });

    return () => {
      cancelled = true;
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
    };
  }, [videoTasks]);

  return (
    <div className="shot-output-cards">
      <div className="shot-output-toolbar">
        <span>已选 {selectedCount} 条</span>
        <Space size={8}>
          <Button size="small" onClick={onToggleAll}>{allSelected ? '取消全选' : '全选'}</Button>
          <Button size="small" icon={<Copy size={15} aria-hidden="true" />} onClick={onCopySelected} disabled={!selectedCount}>复制已选</Button>
        </Space>
      </div>
      {cards.map((card, index) => {
        const parentTask = videoTasks[index];
        const liveTask = liveVideoTasks[index];
        const videoTask = parentTask?.status === 'processing' && liveTask?.taskId === parentTask.taskId
          ? { ...parentTask, ...liveTask }
          : parentTask;
        const submitting = generatingIndexes.has(index);
        const submissionError = submissionErrors[index] || '';
        const statusText = taskStatusText(videoTask, submitting, submissionError);
        const taskActive = submitting || videoTask?.status === 'processing';
        const cardDuration = card.match(/总时长[：:]\s*(\d+s)/)?.[1] || duration;
        const displayRange = getShotMatchDisplayRange(output, card, index, cardStarts[index], activeMatch);
        const highlight = splitShotTextHighlight(card, displayRange);
        const statusType = submissionError || videoTask?.status === 'failed'
          ? 'danger'
          : videoTask?.status === 'succeeded'
            ? 'success'
            : 'secondary';

        return <div className="shot-output-card" key={`${index}-${card.slice(0, 24)}`}>
          <div className="shot-output-card-header">
            <Checkbox checked={selectedIndexes.has(index)} onChange={() => onToggle(index)}>分镜 {index + 1} · {cardDuration}</Checkbox>
            <Space size={8}>
              <Button size="small" icon={<Copy size={15} aria-hidden="true" />} onClick={() => onCopy(card)}>复制本分镜</Button>
              {videoTask?.status === 'succeeded' ? <><Button size="small" type="primary" icon={<Video size={15} aria-hidden="true" />} onClick={() => onOpenVideo?.(videoTask)}>生成成功</Button><Button size="small" icon={<Download size={15} aria-hidden="true" />} href={videoTask.videoUrl} download target="_blank" rel="noreferrer">下载</Button></> : <Button size="small" type="primary" icon={<Video size={15} aria-hidden="true" />} loading={taskActive} disabled={!onGenerateVideo || taskActive} onClick={() => onGenerateVideo(card, index)}>{submitting ? '正在提交' : videoTask?.status === 'processing' ? '视频生成中' : videoTask?.status === 'failed' || submissionError ? '重新生成' : '生成视频'}</Button>}
            </Space>
          </div>
          {statusText ? <Typography.Text type={statusType} style={{ display: 'block', marginBottom: 8 }}>{statusText}</Typography.Text> : null}
          <pre className="shot-output-card-content">{highlight ? <>{highlight.before}<mark className="shot-output-card-match" ref={activeMatchRef}>{highlight.highlight}</mark>{highlight.after}</> : card}</pre>
        </div>;
      })}
    </div>
  );
}
