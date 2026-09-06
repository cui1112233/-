const STAGE_LABELS = {
  queued: '等待执行器领取',
  leased: '执行器已领取',
  preparing: '正在准备豆包页面',
  submitting: '正在提交豆包任务',
  acceptance_unknown: '正在确认豆包是否接单',
  accepted: '豆包已接单',
  generating: '豆包正在生成视频',
  downloading: '正在下载视频',
  uploading: '正在回传视频',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消'
};

export function scriptVideoStageLabel(stage, status) {
  const normalizedStage = String(stage || '').trim().toLowerCase();
  if (STAGE_LABELS[normalizedStage]) return STAGE_LABELS[normalizedStage];

  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (normalizedStatus === 'succeeded') return '已完成';
  if (normalizedStatus === 'failed') return '失败';
  if (normalizedStatus === 'cancelled') return '已取消';
  if (normalizedStatus === 'processing') return '视频任务处理中';
  return '生成视频';
}

export function isScriptVideoTaskActive(task = {}) {
  const taskId = String(task?.taskId || '').trim();
  if (!taskId) return false;
  const status = String(task?.status || '').trim().toLowerCase();
  return !['succeeded', 'failed', 'cancelled'].includes(status);
}

export { STAGE_LABELS };
