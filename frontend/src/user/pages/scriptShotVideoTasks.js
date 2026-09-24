function normalizePrompt(value) {
  return String(value || '').trim();
}

const VALID_VIDEO_TASK_STATUSES = new Set(['processing', 'succeeded', 'failed']);

function isAllowedVideoUrl(value) {
  return typeof value === 'string' && /^(?:https?:\/\/|\/api\/)/i.test(value.trim());
}

function normalizeVideoTask(task) {
  const taskId = String(task?.taskId || '').trim();
  if (!taskId || !VALID_VIDEO_TASK_STATUSES.has(task?.status)) return null;
  const normalized = { taskId, status: task.status };
  if (typeof task.prompt === 'string' && task.prompt.trim()) normalized.prompt = task.prompt.trim().slice(0, 20000);
  if (typeof task.error === 'string' && task.error.trim()) normalized.error = task.error.trim().slice(0, 1000);
  if (isAllowedVideoUrl(task.videoUrl)) normalized.videoUrl = task.videoUrl.trim();
  return normalized;
}

export function isShotVideoTaskCurrent(task, prompt) {
  const savedPrompt = normalizePrompt(task?.prompt);
  return Boolean(savedPrompt) && savedPrompt === normalizePrompt(prompt);
}

export function appendShotVideoTaskHistory(history, index, task) {
  const normalized = normalizeVideoTask(task);
  if (!normalized) return history || {};
  const key = String(index);
  const existing = Array.isArray(history?.[key]) ? history[key] : [];
  if (existing.some(item => item?.taskId === normalized.taskId)) return history || {};
  return {
    ...(history || {}),
    [key]: [...existing, normalized].slice(-20)
  };
}

export function mergeShotVideoTaskHistoryTask(savedTask, freshTask) {
  const saved = normalizeVideoTask(savedTask);
  const fresh = normalizeVideoTask(freshTask);
  if (!fresh) return saved || null;
  if (!saved || saved.taskId !== fresh.taskId) return fresh;
  return normalizeVideoTask({ ...fresh, prompt: saved.prompt || fresh.prompt });
}

export function normalizeShotVideoTaskHistory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [index, tasks] of Object.entries(value)) {
    if (!/^\d+$/.test(index) || !Array.isArray(tasks)) continue;
    const seen = new Set();
    const normalized = tasks.map(normalizeVideoTask).filter(task => {
      if (!task || seen.has(task.taskId)) return false;
      seen.add(task.taskId);
      return true;
    }).slice(-20);
    if (normalized.length) result[index] = normalized;
  }
  return result;
}
