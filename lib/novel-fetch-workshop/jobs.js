// 改文工作台：后台作业（jobs）数据层
// 作业落盘 <systemDir>/novel-fetch-workshop-jobs/{jobId}.json，作业结构：
//   { id, status: running/done/failed, steps: [{ step, status, at, detail }], result, error, createdAt, updatedAt }
// startProcessJob 接收 { workflow, tasksToProcess, stepCallback }：
//   - workflow：执行上下文（如 { username, body }），由注入的 executor 消费
//   - tasksToProcess：预解析任务数组（可为空，worker 内部自行解析）
//   - stepCallback：可选，每次写入 step 时同步回调（{ step, status, at, detail }）
// executor 由 createJobsStore 注入（默认空实现），路由侧把
//   parse/classify/fetch/generateAi 流程包进 executor（复用 tasks.js 相关逻辑）。
// 落盘复用 ../system-store 的 readJsonOrMissing / writeJsonAtomic / withJsonLock。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('../system-store');

const JOBS_DIR_NAME = 'novel-fetch-workshop-jobs';

// 判断普通对象（排除数组 / null）
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// 本地时间 ISO 字符串（毫秒精度，含时区偏移），如 2026-08-18T12:34:56.789+08:00
function isoLocalTimeMs(date) {
  const pad = value => String(value).padStart(2, '0');
  const d = new Date(date);
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// 默认执行器：未注入时返回空结果（业务方应注入自己的流水线执行函数）
async function defaultExecutor() {
  return { parsed: 0, uniqueTasks: 0, tasks: [] };
}

// 创建后台作业 store
// systemDir：系统数据根目录（例如 data/system）；executor：可选后台执行函数
// executor 签名：async ({ jobId, workflow, tasksToProcess, addStep }) => result
//   - addStep({ step, status, detail })：写入一个进度步骤（自动补 at 时间戳）
function createJobsStore({ systemDir, executor } = {}) {
  if (typeof systemDir !== 'string' || !systemDir.trim()) throw new Error('systemDir is required');
  const resolvedSystemDir = path.resolve(systemDir);
  const jobsDir = path.join(resolvedSystemDir, JOBS_DIR_NAME);
  const runJob = typeof executor === 'function' ? executor : defaultExecutor;

  // jobId 白名单：仅字母数字、下划线、连字符（拒绝路径穿越）
  function jobPath(jobId) {
    const safe = String(jobId == null ? '' : jobId).replace(/[^A-Za-z0-9_-]/g, '');
    if (!safe) throw new Error('无效作业ID');
    return path.join(jobsDir, `${safe}.json`);
  }

  function readJob(jobId) {
    const result = readJsonOrMissing(jobPath(jobId));
    return result.found && isPlainObject(result.value) ? result.value : null;
  }

  function writeJob(jobId, data) {
    const job = { ...(isPlainObject(data) ? data : {}), id: jobId, updatedAt: isoLocalTimeMs(new Date()) };
    fs.mkdirSync(jobsDir, { recursive: true });
    withJsonLock(path.join(jobsDir, '.jobs.lock'), () => {
      writeJsonAtomic(jobPath(jobId), job);
    });
    return job;
  }

  // 追加进度步骤（自动补 at 时间戳），保持 job.status 为 running（除非已是 failed/done）
  function appendStep(jobId, step) {
    const job = readJob(jobId) || { id: jobId, status: 'running', steps: [] };
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const entry = {
      step: String((step && step.step) || ''),
      status: String((step && step.status) || 'running'),
      at: isoLocalTimeMs(new Date()),
      detail: String((step && step.detail) || '')
    };
    job.steps = steps.concat(entry);
    job.status = job.status || 'running';
    writeJob(jobId, job);
    return entry;
  }

  // 启动后台作业：写入初始 job 后立即返回 jobId，流水线在 setImmediate 中执行
  function startProcessJob({ workflow = {}, tasksToProcess = [], stepCallback } = {}) {
    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const createdAt = isoLocalTimeMs(new Date());
    writeJob(jobId, {
      status: 'running',
      steps: [{ step: 'start', status: 'running', at: createdAt, detail: '处理任务已启动' }],
      result: null,
      error: '',
      createdAt,
      updatedAt: createdAt
    });

    const addStep = step => appendStep(jobId, step);
    const onStep = typeof stepCallback === 'function' ? stepCallback : null;

    setImmediate(async () => {
      try {
        const result = await runJob({ jobId, workflow, tasksToProcess, addStep });
        const finishedAt = isoLocalTimeMs(new Date());
        const job = readJob(jobId) || { steps: [] };
        writeJob(jobId, {
          ...job,
          status: 'done',
          steps: Array.isArray(job.steps) ? job.steps.concat({ step: 'done', status: 'done', at: finishedAt, detail: '处理完成' }) : job.steps,
          result: isPlainObject(result) ? result : {},
          error: '',
          updatedAt: finishedAt
        });
        if (onStep) onStep({ step: 'done', status: 'done', at: finishedAt, detail: '处理完成' });
      } catch (error) {
        const message = error && error.message ? String(error.message) : String(error);
        const failedAt = isoLocalTimeMs(new Date());
        appendStep(jobId, { step: 'error', status: 'failed', at: failedAt, detail: message });
        const job = readJob(jobId) || {};
        writeJob(jobId, { ...job, status: 'failed', error: message, updatedAt: failedAt });
        if (onStep) onStep({ step: 'error', status: 'failed', at: failedAt, detail: message });
      }
    });

    return jobId;
  }

  // 查询作业详情（不存在返回 null）
  function getJob(jobId) {
    return readJob(jobId);
  }

  // 最近作业列表（按 updatedAt 倒序，limit 默认 10）
  function listLatest(n = 10) {
    const limit = Math.max(1, Math.floor(Number(n) || 10));
    const jobs = [];
    try {
      for (const entry of fs.readdirSync(jobsDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const job = readJob(entry.name.slice(0, -5));
        if (job) jobs.push(job);
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
    jobs.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
    return jobs.slice(0, limit);
  }

  return { startProcessJob, getJob, listLatest };
}

module.exports = { createJobsStore, JOBS_DIR_NAME, isoLocalTimeMs };
