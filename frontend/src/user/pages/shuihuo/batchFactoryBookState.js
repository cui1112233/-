function taskState(task) { return String(task?.status || '').trim().toLowerCase(); }

function bookTasks(book, productionStatus) {
  const jobs = Array.isArray(productionStatus?.jobs) ? productionStatus.jobs : [];
  return jobs.filter(job => job?.bookId === book?.id).flatMap(job => Array.isArray(job?.tasks) ? job.tasks : []);
}

function hasManualAdjustment(book) {
  if (Object.keys(book?.settingsState?.patch || {}).length) return true;
  if ((book?.assetRecords || []).some(asset => asset?.source === 'manual')) return true;
  return (book?.videos || []).some(video => Object.keys(video?.settingsState?.patch || {}).length > 0);
}

export function batchFactoryBookState(book, { productionStatus, mergeStatus } = {}) {
  const sourceText = String(book?.sourceText || '').trim();
  const queueStatus = String(book?.sourceMetadata?.queueStatus || '').trim();
  const manual = hasManualAdjustment(book);
  const tasks = bookTasks(book, productionStatus);
  const failed = tasks.find(task => taskState(task) === 'failed');
  if (failed) return { label: '异常', detail: `VIDEO ${failed.videoId || '未知'} 生成失败${failed.errorMessage ? `：${failed.errorMessage}` : ''}`, tone: 'red', manual };
  const active = tasks.filter(task => ['queued', 'running'].includes(taskState(task)));
  if (active.length) return { label: '处理中', detail: active.length === 1 ? `${active[0].videoId || 'VIDEO'} 生成中` : `视频 ${active.length}/${tasks.length} 处理中`, tone: 'blue', manual };
  const cancelled = tasks.find(task => taskState(task) === 'cancelled');
  if (cancelled) return { label: '已取消', detail: `${cancelled.videoId || 'VIDEO'} 已取消`, tone: 'default', manual };

  const merges = Array.isArray(mergeStatus?.jobs) ? mergeStatus.jobs : [];
  const failedMerge = merges.find(job => taskState(job) === 'failed');
  if (failedMerge) return { label: '异常', detail: `合并失败${failedMerge.errorMessage ? `：${failedMerge.errorMessage}` : ''}`, tone: 'red', manual };
  if (merges.some(job => ['queued', 'running'].includes(taskState(job)))) return { label: '处理中', detail: '合并中', tone: 'blue', manual };
  if (merges.some(job => taskState(job) === 'succeeded' && String(job?.outputUrl || '').trim())) return { label: '待上传', detail: '视频已合并，等待 121 提交', tone: 'cyan', manual };

  if (queueStatus === 'scheduled_waiting') return { label: '待开始', detail: '定时待执行，等待设定时间释放', tone: 'default', manual };
  if (sourceText) return { label: '待开始', detail: '原文已就绪', tone: 'default', manual };
  return { label: '待开始', detail: '等待按书城与 bookId 获取原文', tone: 'default', manual };
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
    websiteSubmit: '—',
    status: state.label,
    state,
    chars: sourceText ? String(sourceText.length) : '—',
    createdAt: String(createdAt || '').trim() || '—'
  };
}
