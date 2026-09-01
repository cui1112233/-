const test = require('node:test');
const assert = require('node:assert/strict');

const { runNovelFetchBatch } = require('../lib/novel-fetch-workshop/runner');

function createConfig(overrides = {}) {
  return {
    workflow: {
      auto_classify_missing: true,
      auto_fetch_original: true,
      auto_rewrite_after_fetch: true,
      auto_submit_after_rewrite: false,
      auto_submit_confirmed: false,
      ...(overrides.workflow || {})
    },
    fetch: { concurrency: 2, default_max_txt: 4000, ...(overrides.fetch || {}) },
    ai: { max_concurrency: 2, ...(overrides.ai || {}) },
    rewrite: { default_ai_count: 1, max_ai_count: 5, ...(overrides.rewrite || {}) },
    web_submit: { enabled: false, ...(overrides.web_submit || {}) }
  };
}

function fixture({ config = createConfig(), fetchResults = {} } = {}) {
  const calls = { saved: [], fetched: [], rules: [], rewrites: [], submits: [], reports: [] };
  const documents = new Map();
  const tasks = {
    async saveTasks(_username, rows) {
      calls.saved.push(structuredClone(rows));
      for (const row of rows) documents.set(row.bookId, { meta: { ...row } });
      return { saved: rows.length };
    },
    async fetchOriginal(_username, bookId, maxTxt) {
      calls.fetched.push({ bookId, maxTxt });
      return fetchResults[bookId] || { status: 'done' };
    },
    async getTask(_username, bookId) {
      return documents.get(bookId) || null;
    }
  };
  const configStore = {
    getConfig: () => config,
    getStyles: () => ['现代通用'],
    getPlatforms: () => [{ id: '15', name: '知乎付费' }, { id: '2', name: '番茄付费' }]
  };
  const parseBooks = () => ({
    parsed: 2,
    uniqueTasks: 2,
    duplicateCount: 0,
    emptyIdCount: 0,
    tasks: [
      { bookId: '1000000000000000001', bookName: '一' },
      { bookId: '1000000000000000002', bookName: '二' }
    ]
  });
  const classifyMissingRows = async ({ tasks: rows }) => ({ tasks: rows, errors: [] });
  const applyRules = async (_tasks, _username, bookId) => { calls.rules.push(bookId); };
  const generateAiVersions = async ({ task }) => {
    calls.rewrites.push(task.bookId);
    return { generated: [{ status: 'done' }] };
  };
  const submit = async body => { calls.submits.push(body); return { success_groups: 1, failed_groups: 0 }; };
  const listTasks = async () => [...documents.values()].map(item => item.meta);
  const report = event => calls.reports.push(event);
  return { calls, tasks, configStore, parseBooks, classifyMissingRows, applyRules, generateAiVersions, submit, listTasks, report };
}

test('runner keeps payload platform fixed and rewrites only successfully fetched books', async () => {
  const f = fixture({ fetchResults: { '1000000000000000002': { status: 'failed' } } });
  const result = await runNovelFetchBatch({
    username: 'tester',
    payload: { input_text: 'x', platform_id: '15', max_txt: 3500, ai_count: 2 },
    ...f
  });

  assert.equal(f.calls.saved.length, 1);
  assert.deepEqual(f.calls.saved[0].map(row => row.platformId), ['15', '15']);
  assert.deepEqual(f.calls.saved[0].map(row => row.platformName), ['知乎付费', '知乎付费']);
  assert.deepEqual(f.calls.fetched, [
    { bookId: '1000000000000000001', maxTxt: 3500 },
    { bookId: '1000000000000000002', maxTxt: 3500 }
  ]);
  assert.deepEqual(f.calls.rules, ['1000000000000000001']);
  assert.deepEqual(f.calls.rewrites, ['1000000000000000001']);
  assert.equal(result.fetched, 1);
  assert.equal(result.fetch_failed, 1);
});

test('runner obeys disabled fetch and does not rewrite unfetched tasks', async () => {
  const f = fixture({ config: createConfig({ workflow: { auto_fetch_original: false } }) });
  const result = await runNovelFetchBatch({ username: 'tester', payload: { input_text: 'x', platform_id: '2' }, ...f });

  assert.deepEqual(f.calls.fetched, []);
  assert.deepEqual(f.calls.rules, []);
  assert.deepEqual(f.calls.rewrites, []);
  assert.equal(result.fetched, 0);
});

test('runner auto submit requires both explicit confirmation and enabled web submit', async () => {
  const blocked = fixture({ config: createConfig({ workflow: { auto_submit_after_rewrite: true, auto_submit_confirmed: false }, web_submit: { enabled: true } }) });
  await runNovelFetchBatch({ username: 'tester', payload: { input_text: 'x', platform_id: '15' }, ...blocked });
  assert.equal(blocked.calls.submits.length, 0);

  const allowed = fixture({ config: createConfig({ workflow: { auto_submit_after_rewrite: true, auto_submit_confirmed: true }, web_submit: { enabled: true } }) });
  await runNovelFetchBatch({ username: 'tester', payload: { input_text: 'x', platform_id: '15' }, ...allowed });
  assert.equal(allowed.calls.submits.length, 1);
  assert.deepEqual(allowed.calls.submits[0].versions, ['ai1']);
});

test('runner reports authoritative pipeline stages instead of fake completion', async () => {
  const f = fixture();
  await runNovelFetchBatch({ username: 'tester', payload: { input_text: 'x', platform_id: '15' }, ...f });
  const types = new Set(f.calls.reports.map(item => item.type));
  for (const type of ['parse', 'classify', 'fetch', 'rewrite', 'submit']) assert.equal(types.has(type), true, `missing ${type}`);
});

test('after preview selection, runner processes only selected task_ids while keeping original input parsing', async () => {
  const f = fixture();
  const selected = '1000000000000000002';
  const result = await runNovelFetchBatch({
    username: 'tester',
    payload: { input_text: '完整原始输入', platform_id: '15', task_ids: [selected] },
    ...f
  });

  assert.deepEqual(f.calls.saved[0].map(row => row.bookId), [selected]);
  assert.deepEqual(f.calls.fetched.map(item => item.bookId), [selected]);
  assert.deepEqual(f.calls.rewrites, [selected]);
  assert.equal(result.unique_tasks, 1);
});
