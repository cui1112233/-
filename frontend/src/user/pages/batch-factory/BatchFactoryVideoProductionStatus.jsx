import { Alert, Button, Card, Collapse, Divider, Segmented, Select, Space, Tag, Typography, message } from 'antd';
import { Combine, Download, Play, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getBatchFactoryMergeCapability, getBatchFactoryProductionStatus, mergeBatchFactoryVideos } from '../../../shared/api/batchFactory';
import { downloadMedia, retryTask } from '../../../shared/api/shuihuoProduction';

const ACTIVE_TASK_STATUSES = new Set(['draft', 'queued', 'running']);
const PREVIEW_SPEED_OPTIONS = [1, 1.1, 1.2, 1.3, 1.5, 1.7, 2];
const MERGE_SOURCE = 'batch_merge';

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
  const [refreshVersion, setRefreshVersion] = useState(0);

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
  }, [projectKey, refreshVersion]);

  return {
    byProjectId,
    error,
    projectIds,
    refreshNow: () => setRefreshVersion(version => version + 1)
  };
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
    entry.source !== MERGE_SOURCE
    && ((task?.id && Number(entry.taskId) === Number(task.id))
      || (segmentId > 0 && Number(entry.segmentId) === segmentId))
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

function VideoResultPreview({ production, downloadName }) {
  const mediaId = Number(production?.media?.id || 0);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const previewUrlRef = useRef('');

  useEffect(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
    setPreviewUrl('');
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = '';
    };
  }, [mediaId]);

  if (!mediaId) return null;

  async function loadPreview() {
    setPreviewLoading(true);
    try {
      const blob = await downloadMedia(mediaId);
      const objectUrl = URL.createObjectURL(blob);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = objectUrl;
      setPreviewUrl(objectUrl);
    } catch (error) {
      message.error(error.message || '加载视频预览失败');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function downloadResult() {
    setDownloadLoading(true);
    try {
      const blob = await downloadMedia(mediaId);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = downloadName || `批量工厂-VIDEO-${mediaId}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) {
      message.error(error.message || '下载视频成品失败');
    } finally {
      setDownloadLoading(false);
    }
  }

  return <Space direction="vertical" size={10} style={{ width: '100%' }}>
    {previewUrl ? <video controls preload="metadata" src={previewUrl} style={{ width: '100%', maxWidth: 560, borderRadius: 8 }} /> : <Button icon={<Play size={15} />} loading={previewLoading} onClick={loadPreview}>加载视频预览</Button>}
    <Button icon={<Download size={15} />} loading={downloadLoading} onClick={downloadResult}>下载成品</Button>
  </Space>;
}

function MergeTimingPanel({ item, videoStates, projectStatus, mergeCapability, refreshNow }) {
  const [speed, setSpeed] = useState(1.5);
  const [merging, setMerging] = useState(false);
  const storyboardTotal = (item.directorResult?.storyboard || []).reduce((sum, video) => sum + Number(video.duration_sec || 0), 0);
  const completedMediaDurations = videoStates
    .map(entry => Number(entry.production?.media?.durationMs || 0))
    .filter(duration => duration > 0);
  const completedTotalMs = completedMediaDurations.length === videoStates.length && videoStates.length
    ? completedMediaDurations.reduce((sum, duration) => sum + duration, 0)
    : 0;
  const sourceDuration = completedTotalMs > 0 ? completedTotalMs / 1000 : storyboardTotal;
  const estimatedDuration = sourceDuration > 0 ? sourceDuration / speed : 0;
  const mediaIds = videoStates.map(entry => Number(entry.production?.media?.id || 0));
  const allVideosReady = videoStates.length > 0 && mediaIds.every(id => Number.isInteger(id) && id > 0)
    && videoStates.every(entry => entry.production?.status === 'succeeded');
  const mergedMedia = [...(projectStatus?.media || [])].reverse().find(media => media.source === MERGE_SOURCE) || null;
  const validBookId = /^\d{1,128}$/.test(String(item.bookId || ''));
  const canMerge = allVideosReady && validBookId && mergeCapability?.ready === true;

  async function mergeVideos() {
    if (!canMerge) return;
    setMerging(true);
    try {
      const result = await mergeBatchFactoryVideos({
        projectId: Number(item.production.projectId),
        bookId: String(item.bookId),
        mediaIds,
        speed
      });
      message.success(`合并完成：${result.filename || `${item.bookId}.mp4`}`);
      refreshNow();
    } catch (error) {
      message.error(error.message || '合并视频失败');
    } finally {
      setMerging(false);
    }
  }

  return <Card
    size="small"
    title={<Space wrap><Combine size={16} /><span>合并成品</span>{mergedMedia ? <Tag color="green">已生成</Tag> : <Tag>待合并</Tag>}</Space>}
  >
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Text type="secondary">按导演顺序合并：{videoStates.map(({ video }) => `VIDEO ${video.id}`).join(' → ') || '暂无 VIDEO'}。原始 VIDEO 会继续保留。</Typography.Text>
      <div>
        <Typography.Text strong>成品时长处理</Typography.Text>
        <div style={{ marginTop: 8 }}>
          <Segmented
            value="speed"
            options={[
              { value: 'speed', label: '倍率' },
              { value: 'audio', label: '跟随音频时长 · 即将支持', disabled: true }
            ]}
          />
        </div>
      </div>
      <Space wrap>
        <Typography.Text strong>倍率</Typography.Text>
        <Select
          value={speed}
          onChange={setSpeed}
          style={{ width: 140 }}
          options={PREVIEW_SPEED_OPTIONS.map(value => ({ value, label: `${value.toFixed(1)}x` }))}
        />
        <Tag>原始总时长 {sourceDuration ? `${sourceDuration.toFixed(1)}s` : '—'}</Tag>
        <Tag color="processing">预计成品 {estimatedDuration ? `${estimatedDuration.toFixed(1)}s` : '—'}</Tag>
        {validBookId ? <Tag color="blue">文件名 {item.bookId}.mp4</Tag> : <Tag color="red">缺少书ID</Tag>}
      </Space>

      {!allVideosReady ? <Alert type="info" showIcon message="等待全部 VIDEO 生成完成" description="只有当前小说的每个 VIDEO 都成功产生视频文件后，才允许合并，避免缺段或串书。" /> : null}
      {mergeCapability && mergeCapability.ready === false ? <Alert type="warning" showIcon message="视频合并服务未就绪" description={mergeCapability.reason || '服务器未检测到 FFmpeg'} /> : null}
      {!validBookId ? <Alert type="warning" showIcon message="当前小说没有可用于最终文件名的书ID" description="小说获取正常转入的任务会携带书ID；合并成品固定使用 {书ID}.mp4，避免后续上传时串书。" /> : null}
      <Alert
        type="info"
        showIcon
        message="跟随音频时长暂不执行"
        description="配音流程接入后，该模式会根据最终配音实际时长自动反推视频倍率，使合并成品时长与音频一致。当前仍只展示入口。"
      />
      <Typography.Text type="secondary">这里的倍率只改变“合并成品视频”，与后续外部后台的“解压倍速”是两个独立参数。</Typography.Text>

      <Space wrap>
        <Button type="primary" icon={<Combine size={15} />} loading={merging} disabled={!canMerge} onClick={mergeVideos}>
          {mergedMedia ? '重新合并' : '合并视频'}
        </Button>
        {mergedMedia ? <Tag color="green">最终上传候选：{item.bookId}.mp4</Tag> : null}
      </Space>

      {mergedMedia ? <>
        <Divider style={{ margin: '4px 0' }} />
        <Typography.Text strong>合并成品预览</Typography.Text>
        {mergedMedia.durationMs ? <Tag style={{ alignSelf: 'flex-start' }}>{(Number(mergedMedia.durationMs) / 1000).toFixed(1)}s</Tag> : null}
        <VideoResultPreview production={{ media: mergedMedia }} downloadName={`${item.bookId}.mp4`} />
      </> : null}
    </Space>
  </Card>;
}

export function BatchFactoryBatchProductionStatus({ batch }) {
  const { byProjectId, error, projectIds, refreshNow } = useBatchFactoryProductionStatus(batch);
  const [retryingTaskId, setRetryingTaskId] = useState(null);
  const [mergeCapability, setMergeCapability] = useState(null);
  const producedItems = (batch?.items || []).filter(item => item.production?.projectId);

  useEffect(() => {
    if (!projectIds.length) return undefined;
    let active = true;
    getBatchFactoryMergeCapability()
      .then(result => { if (active) setMergeCapability(result); })
      .catch(error => { if (active) setMergeCapability({ ready: false, reason: error.message || '无法检测 FFmpeg 合并能力' }); });
    return () => { active = false; };
  }, [projectIds.join(',')]);

  if (!projectIds.length || !producedItems.length) return null;

  const states = producedItems.flatMap(item => {
    const projectStatus = byProjectId[String(item.production.projectId)];
    return (item.directorResult?.storyboard || []).map((_, videoIndex) => resolveBatchFactoryVideoProduction(item, videoIndex, projectStatus)).filter(Boolean);
  });
  const counts = states.reduce((result, state) => {
    const key = state.status || 'draft';
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});

  async function retry(production) {
    const taskId = Number(production?.task?.id || 0);
    if (!taskId) return message.warning('这个 VIDEO 没有可重试的正式任务，请检查首次提交错误。');
    setRetryingTaskId(taskId);
    try {
      await retryTask(taskId);
      message.success('VIDEO 已重新进入生成队列');
      refreshNow();
    } catch (retryError) {
      message.error(retryError.message || '重试视频任务失败');
    } finally {
      setRetryingTaskId(null);
    }
  }

  return <Card title="视频生成进度">
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {error ? <Alert type="warning" showIcon message="生产状态暂时读取失败，系统会自动重试" description={error} /> : null}
      <Space wrap>
        <Tag>总计 {states.length}</Tag>
        <Tag>待生成 {counts.draft || 0}</Tag>
        <Tag color="processing">排队中 {counts.queued || 0}</Tag>
        <Tag color="processing">生成中 {counts.running || 0}</Tag>
        <Tag color="green">已完成 {counts.succeeded || 0}</Tag>
        <Tag color="red">失败 {(counts.failed || 0) + (counts.cancelled || 0)}</Tag>
        <Typography.Text type="secondary">活动任务每 3 秒整批刷新一次；全部结束后自动停止。</Typography.Text>
      </Space>
      <Collapse items={producedItems.map((item, itemIndex) => {
        const projectStatus = byProjectId[String(item.production.projectId)];
        const videoStates = (item.directorResult?.storyboard || []).map((video, videoIndex) => ({
          video,
          production: resolveBatchFactoryVideoProduction(item, videoIndex, projectStatus)
        }));
        const completed = videoStates.filter(entry => entry.production?.status === 'succeeded').length;
        const failed = videoStates.filter(entry => ['failed', 'cancelled'].includes(entry.production?.status)).length;
        const mergedMedia = [...(projectStatus?.media || [])].reverse().find(media => media.source === MERGE_SOURCE);
        return {
          key: item.id,
          label: <Space wrap>
            <Typography.Text strong>{String(itemIndex + 1).padStart(2, '0')} · {item.title}</Typography.Text>
            <Tag>项目 #{item.production.projectId}</Tag>
            <Tag color={completed === videoStates.length && videoStates.length ? 'green' : 'processing'}>{completed}/{videoStates.length} 完成</Tag>
            {failed ? <Tag color="red">{failed} 失败</Tag> : null}
            {mergedMedia ? <Tag color="cyan">已合并</Tag> : null}
          </Space>,
          children: <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {videoStates.map(({ video, production }) => <Card
              key={`${item.id}-${video.id}`}
              size="small"
              title={<Space wrap><span>VIDEO {video.id} · {video.duration_sec}秒</span><ProductionStatusTag production={production} /></Space>}
            >
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Space wrap>
                  {production?.task?.providerTaskId ? <Tag>提供方任务 {production.task.providerTaskId}</Tag> : null}
                  {production?.media?.durationMs ? <Tag>{Math.round(production.media.durationMs / 1000)}秒成品</Tag> : null}
                  {['failed', 'cancelled'].includes(production?.status) && production?.task?.id ? <Button
                    size="small"
                    icon={<RefreshCw size={14} />}
                    loading={retryingTaskId === Number(production.task.id)}
                    onClick={() => retry(production)}
                  >重试这个 VIDEO</Button> : null}
                </Space>
                {production?.error ? <Typography.Text type="danger">{production.error}</Typography.Text> : null}
                <VideoResultPreview production={production} />
              </Space>
            </Card>)}
            <MergeTimingPanel
              item={item}
              videoStates={videoStates}
              projectStatus={projectStatus}
              mergeCapability={mergeCapability}
              refreshNow={refreshNow}
            />
          </Space>
        };
      })} />
    </Space>
  </Card>;
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
      <Typography.Text strong>视频成品</Typography.Text>
      <div style={{ marginTop: 10 }}><VideoResultPreview production={production} /></div>
    </> : null}
  </Card>;
}
