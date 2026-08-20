// 改文工作台：后台作业测试（lib/novel-fetch-workshop/jobs.js）
// 覆盖 startProcessJob（后台执行、逐步写 steps、done/failed 状态）、getJob、listLatest。
// 使用注入的 stub 执行器同步完成，避免真实网络/AI 调用。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const assert = require('node:assert');
const { createJobsStore } = require('../lib/novel-fetch-workshop/jobs');

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-workshop-jobs-'));
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test('startProcessJob 后台执行并逐步写 steps；完成后 status=done、result 落盘', async () => {
  const dir = makeTempDir();
  const store = createJobsStore({
    systemDir: dir,
    executor: async ({ jobId, workflow, tasksToProcess, addStep }) => {
      assert.ok(jobId);
      assert.equal(workflow.inputText, 'x');
      assert.equal(tasksToProcess.length, 1);
      addStep({ step: 'parse', status: 'done', detail: '解析完成：共 2 行' });
      addStep({ step: 'rewrite', status: 'done', detail: 'AI文案生成完成：生成 1 个文件' });
      return { parsed: 2, uniqueTasks: 1, tasks: [{ bookId: '1' }] };
    }
  });
  const jobId = store.startProcessJob({ workflow: { inputText: 'x' }, tasksToProcess: [{ bookId: '1' }] });
  assert.ok(typeof jobId === 'string' && jobId.startsWith('job_'));

  // 初始状态 running，含启动步骤
  let job = store.getJob(jobId);
  assert.equal(job.status, 'running');
  assert.ok(Array.isArray(job.steps) && job.steps.length >= 1);
  assert.equal(job.steps[0].step, 'start');

  // 等待后台执行完成
  await sleep(50);
  job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.uniqueTasks, 1);
  assert.ok(job.result.tasks.length >= 1);
  const steps = job.steps.map(s => s.step);
  assert.ok(steps.includes('parse'));
  assert.ok(steps.includes('rewrite'));
  assert.ok(steps.every(s => s && typeof s === 'string'));

  // 落盘文件存在
  const file = path.join(dir, 'novel-fetch-workshop-jobs', `${jobId}.json`);
  assert.ok(fs.existsSync(file));
});

test('startProcessJob 可注入 stepCallback 同步接收步骤', async () => {
  const dir = makeTempDir();
  const received = [];
  const store = createJobsStore({
    systemDir: dir,
    executor: async ({ addStep }) => {
      addStep({ step: 'fetch', status: 'done', detail: '原文已抓取' });
      return { fetched: 1 };
    }
  });
  const jobId = store.startProcessJob({
    workflow: {},
    stepCallback: (step) => received.push(step)
  });
  await sleep(50);
  assert.equal(store.getJob(jobId).status, 'done');
  assert.ok(received.length >= 1); // 至少收到完成步骤
});

test('executor 抛错 → job.status=failed 且 error 记录', async () => {
  const dir = makeTempDir();
  const store = createJobsStore({
    systemDir: dir,
    executor: async () => { throw new Error('抓取上游失败'); }
  });
  const jobId = store.startProcessJob({ workflow: {} });
  await sleep(50);
  const job = store.getJob(jobId);
  assert.equal(job.status, 'failed');
  assert.match(job.error, /抓取上游失败/);
  const lastStep = job.steps[job.steps.length - 1];
  assert.equal(lastStep.status, 'failed');
});

test('listLatest 按 updatedAt 倒序并限长；getJob 不存在返回 null', async () => {
  const dir = makeTempDir();
  const store = createJobsStore({ systemDir: dir, executor: async () => ({ ok: true }) });
  const id1 = store.startProcessJob({ workflow: { n: 1 } });
  await sleep(15);
  const id2 = store.startProcessJob({ workflow: { n: 2 } });
  await sleep(50);
  const latest = store.listLatest(10);
  assert.equal(latest.length, 2);
  assert.equal(latest[0].id, id2); // 后完成的 updatedAt 更大，排最前
  assert.equal(store.listLatest(1).length, 1);
  assert.equal(store.listLatest(1)[0].id, id2);
  assert.equal(store.getJob('nope'), null);
});

test('createJobsStore 缺 systemDir 抛错', () => {
  assert.throws(() => createJobsStore({}), /systemDir is required/);
});
