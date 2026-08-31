const test = require('node:test');
const assert = require('node:assert/strict');
const { runNovelFetchBatch } = require('../lib/novel-fetch-workshop/runner');

function configStore(config, styles = ['复仇']) {
  return { getConfig: () => config, getStyles: () => styles, getPlatforms: () => [{ id: '2', name: '番茄付费' }] };
}
function parser(tasks) { return () => ({ tasks, parsed: tasks.length, uniqueTasks: tasks.length, duplicateCount: 0, emptyIdCount: 0 }); }
function taskStore(textById = {}) {
  const saved = [];
  const patches = [];
  return {
    saved, patches,
    saveTasks: async (_owner, tasks) => { saved.push(...tasks.map(item => ({ ...item }))); },
    fetchOriginal: async () => ({ status: 'done' }),
    readOriginal: async (_owner, id) => textById[id] || '足够长的正文内容',
    updateTaskMeta: async (_owner, id, patch) => { patches.push([id, patch]); },
    getTask: async (_owner, id) => ({ meta: { bookId: id, aiCount: 1 } })
  };
}

const base = {
  workflow: { auto_classify_missing: false, auto_fetch_original: true, auto_rewrite_after_fetch: false, auto_submit_after_rewrite: false, auto_submit_confirmed: false },
  fetch: { concurrency: 3, min_original_chars: 0, skip_short_original: false },
  ai: { max_concurrency: 4, force_serial_batch: false },
  rewrite: { default_ai_count: 1, max_ai_count: 5 },
  web_submit: { enabled: false, batch_size: 20, flush_seconds: 0 },
  sensitive_ai: { enabled: true }
};

test('short original remains saved but is skipped before rules and rewrite', async () => {
  const tasks = taskStore({ '1': '短文' });
  let rulesCalled = 0; let rewriteCalled = 0;
  const result = await runNovelFetchBatch({
    username: 'alice', payload: { input_text: '1', platform_id: '2' },
    configStore: configStore({ ...base, workflow: { ...base.workflow, auto_rewrite_after_fetch: true }, fetch: { ...base.fetch, min_original_chars: 10, skip_short_original: true } }),
    tasks, parseBooks: parser([{ bookId: '1', style: '复仇', gender: '女频' }]),
    applyRules: async () => { rulesCalled += 1; },
    generateAiVersions: async () => { rewriteCalled += 1; return { generated: [] }; }
  });
  assert.equal(result.skipped_short_original, 1);
  assert.equal(rulesCalled, 0);
  assert.equal(rewriteCalled, 0);
  assert.equal(tasks.patches[0][1].status, 'skipped_short_original');
});

test('invalid style is reclassified against server style catalog when enabled', async () => {
  const tasks = taskStore();
  let classifierInput;
  await runNovelFetchBatch({
    username: 'alice', payload: { input_text: '1', platform_id: '2' },
    configStore: configStore({ ...base, workflow: { ...base.workflow, auto_fetch_original: false, auto_reclassify_invalid_style: true } }),
    tasks, parseBooks: parser([{ bookId: '1', style: '不存在', gender: '女频' }]),
    classifyMissingRows: async ({ tasks: input }) => { classifierInput = input.map(item => ({ ...item })); return { tasks: input.map(item => ({ ...item, style: '复仇', classifyStatus: 'classified' })), errors: [] }; }
  });
  assert.equal(classifierInput[0].style, '');
  assert.equal(tasks.saved[0].style, '复仇');
});

test('force serial batch limits rewrite peak concurrency to one', async () => {
  const rows = ['1','2','3'].map(bookId => ({ bookId, style: '复仇', gender: '女频' }));
  const tasks = taskStore();
  let active = 0; let peak = 0;
  await runNovelFetchBatch({
    username: 'alice', payload: { input_text: 'x', platform_id: '2' },
    configStore: configStore({ ...base, workflow: { ...base.workflow, auto_rewrite_after_fetch: true }, ai: { max_concurrency: 8, force_serial_batch: true } }),
    tasks, parseBooks: parser(rows), applyRules: async () => {},
    generateAiVersions: async () => { active += 1; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 5)); active -= 1; return { generated: [{ status: 'done' }] }; }
  });
  assert.equal(peak, 1);
});

test('automatic submit uses bounded server-side batches', async () => {
  const rows = ['1','2','3','4','5'].map(bookId => ({ bookId, style: '复仇', gender: '女频' }));
  const tasks = taskStore(); const submitted = [];
  await runNovelFetchBatch({
    username: 'alice', payload: { input_text: 'x', platform_id: '2' },
    configStore: configStore({ ...base, workflow: { ...base.workflow, auto_submit_after_rewrite: true, auto_submit_confirmed: true }, web_submit: { enabled: true, batch_size: 2, flush_seconds: 0 } }),
    tasks, parseBooks: parser(rows), applyRules: async () => {},
    submit: async payload => { submitted.push(payload.ids); return { success_groups: 1, failed_groups: 0 }; }
  });
  assert.deepEqual(submitted, [['1','2'], ['3','4'], ['5']]);
});

test('automatic 121 style sync requires ready session and runs at most once per batch', async () => {
  let syncCalls = 0;
  await runNovelFetchBatch({
    username: 'alice', payload: { input_text: '1', platform_id: '2' },
    configStore: configStore({ ...base, workflow: { ...base.workflow, auto_fetch_original: false, auto_sync_site_styles: true } }),
    tasks: taskStore(), parseBooks: parser([{ bookId: '1', style: '复仇', gender: '女频' }]),
    webSessionReady: async () => true,
    syncSiteStyles: async () => { syncCalls += 1; return { ok: true }; }
  });
  assert.equal(syncCalls, 1);

  syncCalls = 0;
  await runNovelFetchBatch({
    username: 'alice', payload: { input_text: '1', platform_id: '2' },
    configStore: configStore({ ...base, workflow: { ...base.workflow, auto_fetch_original: false, auto_sync_site_styles: true } }),
    tasks: taskStore(), parseBooks: parser([{ bookId: '1', style: '复仇', gender: '女频' }]),
    webSessionReady: async () => false,
    syncSiteStyles: async () => { syncCalls += 1; }
  });
  assert.equal(syncCalls, 0);
});
