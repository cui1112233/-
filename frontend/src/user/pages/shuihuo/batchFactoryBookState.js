function taskState(task) { return String(task?.status || '').trim().toLowerCase(); }

function bookTasks(book, productionStatus) {
  const jobs = (Array.isArray(productionStatus?.jobs) ? productionStatus.jobs : []).filter(job => job?.bookId === book?.id);
  const directorRevisionID = String(book?.directorRevision?.id || book?.directorRevisionId || '').trim();
  const currentRevisionJobs = directorRevisionID ? jobs.filter(job => String(job?.directorRevisionId || '').trim() === directorRevisionID) : [];
  return (currentRevisionJobs.length ? currentRevisionJobs : jobs).flatMap(job => Array.isArray(job?.tasks) ? job.tasks : []);
}
function taskUpdatedAt(task, index) {
  const timestamp = Date.parse(task?.updatedAt || task?.createdAt || '');
  return Number.isFinite(timestamp) ? timestamp : index;
}

// Production providers expose task state by VIDEO id. Convert that transport-level
// state into the book's storyboard order before it reaches any UI surface.
export function batchFactoryVideoProgress(book, productionStatus) {
  const videos = Array.isArray(book?.videos) ? book.videos : [];
  const latestByVideo = new Map();
  bookTasks(book, productionStatus).forEach((task, index) => {
    const videoID = String(task?.videoId || '').trim();
    if (!videoID) return;
    const previous = latestByVideo.get(videoID);
    if (!previous || taskUpdatedAt(task, index) >= taskUpdatedAt(previous.task, previous.index)) latestByVideo.set(videoID, { task, index });
  });

  const byVideo = new Map();
  const active = [];
  const failed = [];
  for (const [index, video] of videos.entries()) {
    const videoID = String(video?.id || '').trim();
    const task = latestByVideo.get(videoID)?.task || null;
    const status = taskState(task);
    const storyboardLabel = `分镜 ${index + 1}`;
    let message = '';
    if (status === 'running') message = `正在生成${storyboardLabel}…`;
    else if (status === 'queued') message = `${storyboardLabel} 已排队，等待生成…`;
    else if (status === 'failed') message = `${storyboardLabel} 生成失败${task?.errorMessage ? `：${task.errorMessage}` : ''}`;
    else if (status === 'succeeded') message = `${storyboardLabel} 已生成`;
    const row = { videoID, index, task, status, storyboardLabel, message };
    byVideo.set(videoID, row);
    if (status === 'running' || status === 'queued') active.push(row);
    if (status === 'failed') failed.push(row);
  }
  return { byVideo, active, failed, summary: active.map(item => item.status === 'running' ? `正在生成${item.storyboardLabel}` : `${item.storyboardLabel} 已排队`).join('；') };
}

function hasManualAdjustment(book) {
  if (Object.keys(book?.settingsState?.patch || {}).length) return true;
  if ((book?.assetRecords || []).some(asset => asset?.source === 'manual')) return true;
  return (book?.videos || []).some(video => Object.keys(video?.settingsState?.patch || {}).length > 0);
}

function latestStageRun(summary, stage) {
  return (summary?.runs || []).filter(run => run?.stage === stage).at(-1) || null;
}

function statusFromRun(run, fallback = 'pending') {
  const status = taskState(run);
  if (status === 'succeeded') return 'completed';
  if (['queued', 'running'].includes(status)) return 'running';
  if (status === 'failed') return 'failed';
  return fallback;
}

function websiteSubmitLabel(book) {
  const value = String(book?.sourceMetadata?.websiteSubmitStatus || book?.sourceMetadata?.publishStatus || '').trim().toLowerCase();
  if (['succeeded', 'success', 'completed', 'uploaded'].includes(value)) return '已回读';
  if (['running', 'uploading', 'queued', 'submitted'].includes(value)) return '待回读';
  if (['failed', 'error'].includes(value)) return '失败';
  return '—';
}

function uploadStatus(book) {
  const value = String(book?.sourceMetadata?.publishStatus || book?.sourceMetadata?.websiteSubmitStatus || '').trim().toLowerCase();
  if (['running', 'uploading', 'queued', 'submitted'].includes(value)) return 'running';
  if (['succeeded', 'success', 'completed', 'uploaded'].includes(value)) return 'completed';
  if (['failed', 'error'].includes(value)) return 'failed';
  return 'pending';
}

export function batchFactoryBookTimeline(book, { productionStatus, mergeStatus, stageSummary } = {}) {
  const sourceReady = Boolean(String(book?.sourceText || '').trim());
  const assets = latestStageRun(stageSummary, 'assets');
  const director = latestStageRun(stageSummary, 'director');
  const image = latestStageRun(stageSummary, 'image');
  const videoRun = latestStageRun(stageSummary, 'video');
  const assetsReady = statusFromRun(assets, (book?.assetRecords || []).length ? 'completed' : 'pending');
  const promptReady = statusFromRun(director, (book?.videos || []).some(video => String(video?.videoPrompt || video?.description || '').trim()) ? 'completed' : 'pending');
  const allVideoTasks = bookTasks(book, productionStatus);
  const videoProgress = batchFactoryVideoProgress(book, productionStatus);
  // For a storyboard with retries, the latest task is its authoritative
  // state. Historical failures remain visible in logs but cannot override a
  // later successful retry in the book-level workflow card.
  const hasStoryboards = (book?.videos || []).length > 0;
  const failedVideo = videoProgress.failed[0]?.task || (!hasStoryboards ? allVideoTasks.find(task => taskState(task) === 'failed') : null);
  const activeVideo = videoProgress.active[0]?.task || (!hasStoryboards ? allVideoTasks.find(task => ['queued', 'running'].includes(taskState(task))) : null);
  const completedVideos = (book?.videos || []).length > 0 && (book?.videos || []).every(video => videoProgress.byVideo.get(String(video?.id || ''))?.status === 'succeeded');
  const merge = (mergeStatus?.jobs || []).filter(job => job?.bookId === book?.id).at(-1);
  const upload = uploadStatus(book);
  const videoStatus = failedVideo ? 'failed' : activeVideo ? 'running' : completedVideos ? 'completed' : statusFromRun(videoRun);
  const mergeStatusValue = taskState(merge);
  const merged = mergeStatusValue === 'succeeded' && String(merge?.outputUrl || '').trim();
  const mergeFailed = mergeStatusValue === 'failed';
  const mergeRunning = ['queued', 'running'].includes(mergeStatusValue);
  const uploadDetail = upload === 'running' ? '正在上传网络' : upload === 'completed' ? '上传成功' : upload === 'failed' ? (book?.sourceMetadata?.publishError || '上传失败') : merged ? '等待上传网络' : '完成合成后可上传';
  return [
    { key: 'source', label: '原文已就绪', status: sourceReady ? 'completed' : 'pending', detail: sourceReady ? '原文已保存' : '等待原文' },
    { key: 'assets', label: '资产（人物/场景/图片）已就绪', status: assetsReady, detail: assets?.errorMessage || (assetsReady === 'completed' ? '资产已生成或已维护' : '等待资产处理') },
    { key: 'director', label: '文本提示词已就绪', status: promptReady, detail: director?.errorMessage || (promptReady === 'completed' ? '分镜与提示词已生成' : '等待生成文本提示词') },
    { key: 'video', label: '视频生成', status: videoStatus, detail: failedVideo?.errorMessage || videoProgress.summary || videoRun?.errorMessage || (videoStatus === 'completed' ? 'VIDEO 已生成' : '等待生成视频') },
    { key: 'upload', label: upload === 'running' ? '正在上传网络' : upload === 'completed' ? '上传成功' : '上传网络', status: upload, detail: uploadDetail },
    { key: 'complete', label: '完成', status: upload === 'completed' ? 'completed' : (mergeFailed ? 'failed' : mergeRunning ? 'running' : 'pending'), detail: merge?.errorMessage || (upload === 'completed' ? '本书生产与上传均已完成' : mergeRunning ? '正在合成最终视频' : merged ? '等待上传成功回执' : '等待最终视频合成') }
  ];
}

export function batchFactoryBookState(book, { productionStatus, mergeStatus, stageSummary } = {}) {
  const sourceText = String(book?.sourceText || '').trim();
  const queueStatus = String(book?.sourceMetadata?.queueStatus || '').trim();
  const manual = hasManualAdjustment(book);
  const timeline = batchFactoryBookTimeline(book, { productionStatus, mergeStatus, stageSummary });
  const failedStep = timeline.find(item => item.status === 'failed');
  if (failedStep) return { label: '异常', detail: `${failedStep.label}：${failedStep.detail}`, tone: 'red', manual, failedStep };
  const activeStep = timeline.find(item => item.status === 'running');
  if (activeStep) return { label: '执行中…', detail: `${activeStep.label}：${activeStep.detail}`, tone: 'blue', manual };
  if (timeline.find(item => item.key === 'complete')?.status === 'completed') return { label: '完成', detail: '本书生产与上传均已完成', tone: 'green', manual };
  const tasks = bookTasks(book, productionStatus);
  const videoProgress = batchFactoryVideoProgress(book, productionStatus);
  const failed = videoProgress.failed[0]?.task;
  if (failed) return { label: '异常', detail: videoProgress.failed[0].message, tone: 'red', manual };
  if (videoProgress.active.length) return { label: '处理中', detail: videoProgress.summary, tone: 'blue', manual };
  const cancelled = tasks.find(task => taskState(task) === 'cancelled');
  if (cancelled) return { label: '已取消', detail: `${cancelled.videoId || 'VIDEO'} 已取消`, tone: 'default', manual };

  const merges = (Array.isArray(mergeStatus?.jobs) ? mergeStatus.jobs : [])
    .filter(job => job?.bookId === book?.id);
  const failedMerge = merges.find(job => taskState(job) === 'failed');
  if (failedMerge) return { label: '异常', detail: `合并失败${failedMerge.errorMessage ? `：${failedMerge.errorMessage}` : ''}`, tone: 'red', manual };
  if (merges.some(job => ['queued', 'running'].includes(taskState(job)))) return { label: '处理中', detail: '合并中', tone: 'blue', manual };
  if (merges.some(job => taskState(job) === 'succeeded' && String(job?.outputUrl || '').trim())) return { label: '待上传', detail: '视频已合并，等待 121 提交', tone: 'cyan', manual };
  if (timeline.find(item => item.key === 'video')?.status === 'completed') return { label: '待合成', detail: '所有分镜视频已生成，等待合成', tone: 'cyan', manual };

  if (queueStatus === 'scheduled_waiting') return { label: '待开始', detail: '定时待执行，等待设定时间释放', tone: 'default', manual };
  if (sourceText) return { label: '待开始', detail: '原文已就绪', tone: 'default', manual };
  return { label: '待开始', detail: '等待按书城与 bookId 获取原文', tone: 'default', manual };
}

export function batchFactoryBatchProgress(books, runtime = {}) {
  const result = {
    total: 0,
    uploaded: 0,
    failed: 0,
    running: 0,
    awaitingUpload: 0,
    pending: 0,
    completionPercent: 0
  };
  const values = Array.isArray(books) ? books : [];
  result.total = values.length;
  for (const book of values) {
    const state = batchFactoryBookState(book, {
      ...runtime,
      stageSummary: runtime.stageSummaries?.[book?.id] || runtime.stageSummary
    });
    if (state.label === '完成') result.uploaded += 1;
    else if (state.label === '异常') result.failed += 1;
    else if (state.label === '执行中…' || state.label === '处理中') result.running += 1;
    else if (state.label === '待上传') result.awaitingUpload += 1;
    else result.pending += 1;
  }
  result.completionPercent = result.total ? Math.round((result.uploaded / result.total) * 100) : 0;
  return result;
}

export function batchFactoryNovelTableRow(book, index, createdAt = '', runtime = {}) {
  const sourceText = String(book?.sourceText || '').trim();
  const state = batchFactoryBookState(book, runtime);
  return {
    id: index + 1,
    title: String(book?.title || '').trim() || `小说 ${index + 1}`,
    bookId: String(book?.bookId || '').trim() || '—',
    original: sourceText ? '✓' : '—',
    ai1: '—',
    websiteSubmit: websiteSubmitLabel(book),
    status: state.label,
    state,
    chars: sourceText ? String(sourceText.length) : '—',
    createdAt: String(createdAt || '').trim() || '—'
  };
}
