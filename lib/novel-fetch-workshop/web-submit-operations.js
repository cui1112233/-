const crypto = require('node:crypto');

const PRIVATE_KEYS = new Set([
  'password', 'password_plain', 'token', 'access_token', 'refresh_token', 'secret',
  'cookie', 'cookies', 'authorization', 'sessionkey', 'session_key'
]);

function safeSnapshot(value) {
  if (Array.isArray(value)) return value.map(safeSnapshot);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !PRIVATE_KEYS.has(String(key).toLowerCase()))
    .map(([key, item]) => [key, safeSnapshot(item)]));
}

function createWebSubmitOperationStore({
  now = () => new Date().toISOString(),
  schedule = fn => setImmediate(fn),
  operationTimeoutMs = Number(process.env.QIANTIE_WEB_SUBMIT_OPERATION_TIMEOUT_MS) || 180_000,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  const operations = new Map();
  const timeoutMs = Math.max(1_000, Number(operationTimeoutMs) || 180_000);

  function key(owner, id) {
    return `${String(owner || '')}:${String(id || '')}`;
  }

  function publicOperation(operation) {
    if (!operation) return null;
    return safeSnapshot({
      id: operation.id,
      kind: operation.kind,
      status: operation.status,
      steps: operation.steps,
      result: operation.result,
      error: operation.error,
      started_at: operation.started_at,
      updated_at: operation.updated_at,
      completed_at: operation.completed_at,
    });
  }

  function addStep(operation, stage, message) {
    operation.steps.push({ stage, message: String(message || ''), at: now() });
    operation.updated_at = now();
  }

  function create(owner, kind, run, labels = {}) {
    if (typeof run !== 'function') throw new Error('operation runner is required');
    const operation = {
      id: crypto.randomUUID(),
      owner: String(owner || ''),
      kind: String(kind || ''),
      status: 'running',
      steps: [],
      result: null,
      error: '',
      started_at: now(),
      updated_at: now(),
      completed_at: '',
    };
    operations.set(key(operation.owner, operation.id), operation);
    addStep(operation, 'queued', labels.queued || '已进入后台任务');
    schedule(async () => {
      let timeoutHandle;
      try {
        addStep(operation, 'running', labels.running || '正在处理');
        const timeout = new Promise((_, reject) => {
          timeoutHandle = setTimeoutImpl(() => {
            const error = new Error('121 后台操作超时，请检查接口或登录会话后重试');
            error.code = 'WEB_SUBMIT_OPERATION_TIMEOUT';
            error.status = 504;
            reject(error);
          }, timeoutMs);
        });
        operation.result = safeSnapshot(await Promise.race([
          Promise.resolve().then(() => run((stage, message) => addStep(operation, stage, message))),
          timeout
        ]));
        operation.status = 'done';
        addStep(operation, 'done', labels.done || '处理完成');
      } catch (error) {
        operation.status = 'failed';
        operation.error = String(error?.message || error || '后台操作失败');
        addStep(operation, 'failed', operation.error);
      } finally {
        if (timeoutHandle !== undefined) clearTimeoutImpl(timeoutHandle);
        operation.completed_at = now();
        operation.updated_at = operation.completed_at;
      }
    });
    return publicOperation(operation);
  }

  function get(owner, id) {
    return publicOperation(operations.get(key(owner, id)));
  }

  return { create, get };
}

module.exports = { createWebSubmitOperationStore, safeSnapshot };
