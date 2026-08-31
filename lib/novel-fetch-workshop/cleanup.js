function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function idOf(task) { return String(task?.bookId || task?.book_id || task?.id || '').trim(); }
function timestampOf(task) { return String(task?.updatedAt || task?.updated_at || task?.createdAt || task?.created_at || '').trim(); }
function statusOf(task) { return String(task?.status || '').trim().toLowerCase(); }

const TERMINAL = new Set(['done', 'completed', 'submitted', 'success', 'skipped_short_original']);
const NEVER_AUTO_DELETE = new Set(['failed', 'error', 'waiting_retry', 'waiting', 'queued', 'running', 'paused', 'stopping', 'scheduled', 'cancelled', 'permanently_deleted']);

function isDefinitelyTerminal(task) {
  if (!task || task.tombstoned === true || task.permanentlyDeleted === true || task.permanently_deleted === true) return false;
  const status = statusOf(task);
  if (!status || NEVER_AUTO_DELETE.has(status)) return false;
  return TERMINAL.has(status);
}

function planNovelFetchCleanup(tasks, policy = {}, now = new Date()) {
  const cfg = object(policy);
  if (cfg.cleanup_enabled !== true) return { enabled: false, deleteIds: [], kept: Array.isArray(tasks) ? tasks.length : 0 };
  const retentionDays = Math.max(1, Math.min(3650, Math.floor(Number(cfg.retention_days) || 30)));
  const cutoff = new Date(now).getTime() - retentionDays * 86400000;
  const deleteIds = [];
  let kept = 0;
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const id = idOf(task);
    const time = Date.parse(timestampOf(task));
    if (id && Number.isFinite(time) && time < cutoff && isDefinitelyTerminal(task)) deleteIds.push(id);
    else kept += 1;
  }
  return { enabled: true, retentionDays, cutoff: new Date(cutoff).toISOString(), deleteIds, kept };
}

async function runNovelFetchCleanup({ owner, store, policy, now = new Date(), dryRun = false } = {}) {
  if (!owner) throw new Error('owner is required');
  if (!store || typeof store.listTasks !== 'function') throw new Error('cleanup store is required');
  const tasks = await store.listTasks(owner);
  const plan = planNovelFetchCleanup(tasks, policy, now);
  if (!plan.enabled || dryRun || !plan.deleteIds.length) return { ...plan, dryRun: Boolean(dryRun), deleted: 0 };
  if (typeof store.deleteTasks !== 'function') throw new Error('cleanup deleteTasks is required');
  const result = await store.deleteTasks(owner, plan.deleteIds);
  return { ...plan, dryRun: false, deleted: Number(result?.deleted) || plan.deleteIds.length };
}

module.exports = { isDefinitelyTerminal, planNovelFetchCleanup, runNovelFetchCleanup };
