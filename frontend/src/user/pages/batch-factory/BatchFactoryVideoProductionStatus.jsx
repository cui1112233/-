import { Button, Card, Divider, Space, Tag, Typography } from 'antd';
import { Download, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getBatchFactoryProductionStatus } from '../../../shared/api/batchFactory';

const ACTIVE_TASK_STATUSES = new Set(['draft', 'queued', 'running']);

const taskStatusMeta = {
  draft: ['待生成', 'default'],
  queued: ['排队中', 'processing'],
  running: ['生成中', 'processing'],
  succeeded: ['已完成', 'green'],
  failed: ['失败', 'red'],
  cancelled: ['失败', 'red']
};

function normalizeProjectIds(batch) {
  const ids = (batch?.items || [])
    .map(item => Number(item.production?.projectId))
    .filter(id => Number.isInteger(id) && id > 0);
  return [...new Set(ids)].sort((a, b) => a - b);
}

export function useBatchFactoryProductionStatus(batch) {
  const projectIds = useMemo(() => normalizeProjectIds(batch), [batch]);
  const projectKey = projectIds.join(',');
  const [byProjectId, setByProjectId] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectIds.length) {
      setByProjectId({});
      setError('');
      return undefined;
    }

    let cancelled = false;
    let timer = null;

    async function refresh() {
      try {
        const result = await getBatchFactoryProductionStatus(projectIds);
        if (cancelled) return;
        const next = {};
        let hasActive = false;
        for (const project of result.projects || []) {
          next[String(project.projectId)] = project;
          if ((project.tasks || []).some(task => ACTIVE_TASK_STATUSES.has(task.status))) hasActive = true;
        }
        setByProjectId(next);
        setError('');
        if (hasActive) timer = window.setTimeout(refresh, 3000);
      } catch (requestError) {
        if (cancelled) return;
        setError(requestError.message || '读取视频生产状态失败');
        timer = window.setTimeout(refresh, 5000);
      }
    }

    refresh();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [projectKey]);

  return { byProjectId, error, projectIds };
}

export function resolveBatchFactoryVideoProduction(item, videoIndex, projectStatus) {
  if (!item?.production?.projectId) return null;
  const results = Array.isArray(item.productionResults) ? item.productionResults : [];
  const submission = results.find(result => Number(result.index) === videoIndex + 1) || results[videoIndex] || null;
  if (submission?.error && !submission?.task) {
    return { status: 'failed', error: submission.error, task: null, media: null };
  }

  const segmentId = Number(submission?.segmentId || submission?.task?.segmentId || 0);
  const submittedTaskId = Number(submission?.task?.id || 0);
  const tasks = Array.isArray(projectStatus?.tasks) ? projectStatus.tasks : [];
  const matchingTasks = tasks.filter(task => (
    (segmentId > 0 && Number(task.segmentId) === segmentId)
    || (submittedTaskId > 0 && Number(task.id) === submittedTaskId)
  ));
  const task = matchingTasks[matchingTasks.length - 1] || submission?.task || null;
  const mediaList = Array.isArray(projectStatus?.media) ? projectStatus.media : [];
  const media = [...mediaList].reverse().find(entry => (
    (task?.id && Number(entry.taskId) === Number(task.id))
    || (segmentId > 0 && Number(entry.segmentId) === segmentId)
  )) || null;
  const status = media ? 'succeeded' : (task?.status || (submission ? 'queued' : 'draft'));
  return {
    status,
    error: task?.errorMessage || submission?.error || '',
    task,
    media
  };
}

function ProductionStatusTag({ production }) {
  if (!production) return null;
  const [label, color] = taskStatusMeta[production.status] || [production.status || '待生成', 'default'];
  return <Tag color={color}>{label}</Tag>;
}

export function BatchFactoryVideoPlanCard({ item, video, videoIndex, projectStatus, onCompile }) {
  const production = resolveBatchFactoryVideoProduction(item, videoIndex, projectStatus);
  return <Card
    size="small"
    title={<Space wrap><span>VIDEO {video.id} · {video.duration_sec}秒</span><ProductionStatusTag production={production} /></Space>}
    extra={<Button icon={<Sparkles size={15} />} onClick={onCompile}>查看最终上传 Prompt</Button>}
  >
    <Space wrap style={{ marginBottom: 8 }}>
      <Tag>{video.scene || '未指定场景'}</Tag>
      <Tag>{video.prefix_key || 'general_anime'}</Tag>
      <Tag>{video.characters?.join('、') || '无人'}</Tag>
      {production?.task?.providerTaskId ? <Tag>提供方任务 {production.task.providerTaskId}</Tag> : null}
    </Space>
    <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{video.video_desc}</Typography.Paragraph>
    <Divider style={{ margin: '12px 0' }} />
    {(video.shots || []).map((shot, shotIndex) => <div key={`${video.id}-${shotIndex}`} style={{ marginBottom: 8 }}>
      <Typography.Text strong>{shot.start_sec}-{shot.end_sec}秒 {shot.shot_type ? `· ${shot.shot_type}` : ''} {shot.camera ? `· ${shot.camera}` : ''}</Typography.Text>
      <div>{shot.description}</div>
    </div>)}

    {production?.error ? <Typography.Paragraph type="danger" style={{ marginTop: 12, marginBottom: 0 }}>{production.error}</Typography.Paragraph> : null}
    {production?.media ? <>
      <Divider style={{ margin: '14px 0' }} />
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Typography.Text strong>视频成品</Typography.Text>
        <video
          controls
          preload="metadata"
          src={production.media.downloadPath}
          style={{ width: '100%', maxWidth: 560, borderRadius: 8 }}
        />
        <Button icon={<Download size={15} />} href={production.media.downloadPath} target="_blank" rel="noreferrer">打开 / 下载成品</Button>
      </Space>
    </> : null}
  </Card>;
}
