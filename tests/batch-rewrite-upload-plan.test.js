const express = require('express');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBatchRewriteRouter } = require('../routes/batch-rewrite');

async function request(app, path, body, method = 'POST') {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const organizationConfig = {
  organization_catalog: { field_name: 'organization_id', options: [{ id: '7', name: '第一组织' }] },
  selected_organization: '7'
};

const defaultVersionProfile = {
  id: '121-default', name: '121 默认配置', enabled: true, source: '121', config_id: 'default',
  platform_id: '2', gender: '女', style: '现代女主', is_default: true,
  advanced: { jieyaNum: 4, gunpingNum: 4 }
};

test('历史自由配置字段也强制按版本配置档执行', async () => {
  const task = {
    meta: {
      bookId: 'book-1', bookName: '示例书', platformId: '2', platformName: '番茄付费',
      gender: '女频', style: '现代女主', siteSubmitDoneVersions: []
    }
  };
  const config = {
    web_submit: {
      submit_versions: ['ai1', 'ai2'],
      advanced: { jieyaNum: 4, gunpingNum: 4, jieyaSpeed: 1.7, keywords: '全局关键词' },
      upload_profiles: [defaultVersionProfile, { id: 'ai2-fast', name: 'AI2 快速配置', platform_id: '2', gender: '女', style: '现代女主', advanced: { jieyaSpeed: 1.9, ziti: 6 } }],
      profile_bindings: { ai1: '121-default', ai2: 'ai2-fast' },
      submit_mode: 'free'
    },
    platforms: [], styles: []
  };
  const app = express().use(express.json()).use('/api/batch-rewrite', createBatchRewriteRouter({
    auth: (req, res, next) => { req.username = 'writer-a'; next(); },
    knowledgeStore: { list: () => ({}) },
    openingStore: {},
    tasksFactory: async () => ({
      tasks: {
        getTask: async () => task,
        readVersionText: async (_username, _id, version) => `${version} 文案`,
        listTasks: async () => []
      },
      config,
      configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => [] }
    })
  }));

  const response = await request(app, '/api/batch-rewrite/web-submit/preview', {
    mode: 'selected', ids: ['book-1'], versions: ['ai1', 'ai2']
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.material_limit, 8);
  const allocations = response.body.groups
    .flatMap(group => group.items)
    .map(item => [item.version, item.advanced.jieyaNum, item.advanced.gunpingNum])
    .sort((left, right) => left[0].localeCompare(right[0]));
  assert.deepEqual(allocations, [['ai1', 4, 4], ['ai2', 4, 4]]);
  const ai2 = response.body.groups.flatMap(group => group.items).find(item => item.version === 'ai2');
  assert.equal(ai2.profile_name, 'AI2 快速配置');
  assert.equal(ai2.advanced.jieyaSpeed, 1.9);
  assert.equal(ai2.advanced.ziti, 6);
});

test('版本配置优先使用已绑定的 121 配置档，不再套用自由配置的素材均分', async () => {
  const task = { meta: { bookId: 'book-1', bookName: '示例书', platformId: '2', gender: '女频', style: '现代女主', siteSubmitDoneVersions: [] } };
  const config = {
    web_submit: {
      submit_mode: 'version', submit_versions: ['ai1'], advanced: { jieyaNum: 4, gunpingNum: 4 },
      upload_profiles: [{ id: '121-9', name: '121 AI1 配置', config_id: '9', source: '121', advanced: { jieyaNum: 3, gunpingNum: 5, jieyaSpeed: 1.9, ziti: 6 } }],
      profile_bindings: { ai1: '121-9' }
    }, platforms: [], styles: []
  };
  const app = express().use(express.json()).use('/api/batch-rewrite', createBatchRewriteRouter({
    auth: (req, res, next) => { req.username = 'writer-a'; next(); }, knowledgeStore: { list: () => ({}) }, openingStore: {},
    tasksFactory: async () => ({ tasks: { getTask: async () => task, readVersionText: async () => 'AI1 文案', listTasks: async () => [] }, config, configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => [] } })
  }));
  const response = await request(app, '/api/batch-rewrite/web-submit/preview', { mode: 'selected', ids: ['book-1'], versions: ['ai1'] });
  assert.equal(response.status, 200);
  const item = response.body.groups.flatMap(group => group.items)[0];
  assert.equal(item.profile_name, '121 AI1 配置');
  assert.equal(item.advanced.jieyaNum, 3);
  assert.equal(item.advanced.gunpingNum, 5);
  assert.equal(item.advanced.jieyaSpeed, 1.9);
});

test('版本配置未绑定时会按平台、男女频、风格匹配 121 配置档', async () => {
  const task = { meta: { bookId: 'book-2', bookName: '示例书', platformId: '2', gender: '女频', style: '现代女主', siteSubmitDoneVersions: [] } };
  const config = {
    web_submit: {
      submit_mode: 'version', submit_versions: ['ai1'],
      upload_profiles: [
        { id: 'wrong', name: '不匹配', platform_id: '2', gender: '女', style: '古风虐文', advanced: { jieyaNum: 8, gunpingNum: 0 } },
        { id: 'matched', name: '现代女主档', platform_id: '2', gender: '女', style: '现代女主', advanced: { jieyaNum: 1, gunpingNum: 7 } }
      ], profile_bindings: {}
    }, platforms: [], styles: []
  };
  const app = express().use(express.json()).use('/api/batch-rewrite', createBatchRewriteRouter({
    auth: (req, res, next) => { req.username = 'writer-a'; next(); }, knowledgeStore: { list: () => ({}) }, openingStore: {},
    tasksFactory: async () => ({ tasks: { getTask: async () => task, readVersionText: async () => 'AI1 文案', listTasks: async () => [] }, config, configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => [] } })
  }));
  const response = await request(app, '/api/batch-rewrite/web-submit/preview', { mode: 'selected', ids: ['book-2'], versions: ['ai1'] });
  const item = response.body.groups.flatMap(group => group.items)[0];
  assert.equal(item.profile_id, 'matched');
  assert.equal(item.advanced.gunpingNum, 7);
});

test('121 仅确认文件接收时必须标为待确认，不能伪装成已执行成功', async () => {
  const meta = {
    bookId: '2071717253981255675', bookName: '待确认书', platformId: '2', platformName: '番茄付费',
    gender: '女频', style: '现代女主', siteSubmitDoneVersions: [], siteSubmitAcceptedVersions: []
  };
  const logs = [];
  const config = { web_submit: { ...organizationConfig, enabled: true, submit_versions: ['ai1'], advanced: { jieyaNum: 4, gunpingNum: 4 }, upload_profiles: [defaultVersionProfile], profile_bindings: { ai1: '121-default' } }, platforms: [], styles: [] };
  const app = express().use(express.json()).use('/api/batch-rewrite', createBatchRewriteRouter({
    auth: (req, res, next) => { req.username = 'writer-a'; next(); },
    novelFetchStore: { getSession: () => ({ cookie: 'session=yes' }) },
    knowledgeStore: { list: () => ({}) },
    openingStore: {},
    httpClient: async () => ({ body: JSON.stringify({ success: true, message: '文件已接收' }), headers: {} }),
    tasksFactory: async () => ({
      tasks: {
        getTask: async () => ({ meta }),
        readVersionText: async () => '可上传的 AI 文案',
        updateTaskMeta: async (_username, _id, patch) => Object.assign(meta, patch),
        appendSiteSubmitLog: async (_username, _id, entry) => logs.push(entry),
        listTasks: async () => [{ ...meta }]
      },
      config,
      configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => [] }
    })
  }));

  const response = await request(app, '/api/batch-rewrite/web-submit/submit', {
    mode: 'selected', ids: ['2071717253981255675'], versions: ['ai1']
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success_groups, 0);
  assert.equal(response.body.accepted_groups, 1);
  assert.equal(response.body.groups[0].status, 'accepted_pending');
  assert.deepEqual(meta.siteSubmitDoneVersions, []);
  assert.deepEqual(meta.siteSubmitAcceptedVersions, ['ai1']);
  assert.equal(logs[0].status, 'accepted_pending');
  assert.equal(logs[0].remote_receipt.verified, false);
});

test('网站提交在未选择组织归属时不会发送 121 上传请求', async () => {
  const meta = { bookId: '2071717253981255675', platformId: '2', gender: '女频', style: '现代女主', siteSubmitDoneVersions: [] };
  const config = { web_submit: { enabled: true, submit_versions: ['ai1'], advanced: { jieyaNum: 4, gunpingNum: 4 }, upload_profiles: [defaultVersionProfile], profile_bindings: { ai1: '121-default' } }, platforms: [], styles: [] };
  let requestCount = 0;
  const app = express().use(express.json()).use('/api/batch-rewrite', createBatchRewriteRouter({
    auth: (req, res, next) => { req.username = 'writer-a'; next(); },
    novelFetchStore: { getSession: () => ({ cookie: 'session=yes' }) }, knowledgeStore: { list: () => ({}) }, openingStore: {},
    httpClient: async () => { requestCount++; return { body: JSON.stringify({ success: true }), headers: {} }; },
    tasksFactory: async () => ({
      tasks: { getTask: async () => ({ meta }), readVersionText: async () => '可上传文案', updateTaskMeta: async () => {}, appendSiteSubmitLog: async () => {}, listTasks: async () => [] },
      config, configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => [] }
    })
  }));
  const response = await request(app, '/api/batch-rewrite/web-submit/submit', { mode: 'selected', ids: [meta.bookId], versions: ['ai1'] });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /请选择组织归属/);
  assert.equal(requestCount, 0);
});

test('任务直提交不依赖网络设置页的启用开关', async () => {
  const meta = { bookId: '2071717253981255675', bookName: '直提交示例', platformId: '2', platformName: '番茄付费', gender: '女频', style: '现代女主', siteSubmitDoneVersions: [], siteSubmitAcceptedVersions: [] };
  const config = { web_submit: { ...organizationConfig, enabled: false, submit_versions: ['ai1'], advanced: { jieyaNum: 4, gunpingNum: 4 }, upload_profiles: [defaultVersionProfile], profile_bindings: { ai1: '121-default' } }, platforms: [], styles: [] };
  const app = express().use(express.json()).use('/api/batch-rewrite', createBatchRewriteRouter({
    auth: (req, res, next) => { req.username = 'writer-a'; next(); },
    novelFetchStore: { getSession: () => ({ cookie: 'session=yes' }) },
    knowledgeStore: { list: () => ({}) }, openingStore: {},
    httpClient: async () => ({ body: JSON.stringify({ success: true, result: { success: { count: 1, files: [{ name: '2071717253981255675.txt' }] }, failed: { count: 0, files: [] } } }), headers: {} }),
    tasksFactory: async () => ({
      tasks: {
        getTask: async () => ({ meta }),
        readVersionText: async () => '可上传的 AI 文案',
        updateTaskMeta: async (_username, _id, patch) => Object.assign(meta, patch),
        appendSiteSubmitLog: async () => {},
        listTasks: async () => [{ ...meta }]
      },
      config,
      configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => [] }
    })
  }));

  const response = await request(app, '/api/batch-rewrite/web-submit/submit', { mode: 'selected', ids: [meta.bookId], versions: ['ai1'] });

  assert.equal(response.status, 200);
  assert.equal(response.body.success_groups, 1);
  assert.deepEqual(meta.siteSubmitDoneVersions, ['ai1']);
});

test('121 返回文件处理失败时不能标记待确认，必须直接报出拒绝原因', async () => {
  const meta = { bookId: '2071717253981255675', platformId: '2', platformName: '番茄付费', gender: '女频', style: '现代女主', siteSubmitDoneVersions: [], siteSubmitAcceptedVersions: [] };
  const logs = [];
  const config = { web_submit: { ...organizationConfig, enabled: true, submit_versions: ['ai1'], advanced: { jieyaNum: 4, gunpingNum: 4 }, upload_profiles: [defaultVersionProfile], profile_bindings: { ai1: '121-default' } }, platforms: [], styles: [] };
  const app = express().use(express.json()).use('/api/batch-rewrite', createBatchRewriteRouter({
    auth: (req, res, next) => { req.username = 'writer-a'; next(); },
    novelFetchStore: { getSession: () => ({ cookie: 'session=yes' }) }, knowledgeStore: { list: () => ({}) }, openingStore: {},
    httpClient: async () => ({ body: JSON.stringify({ success: true, result: { success: { count: 0, files: [] }, failed: { count: 1, files: [{ name: '2071717253981255675-ai1.txt', reason: '文件名必须是纯数字(书号)或UUID格式' }] } } }), headers: {} }),
    tasksFactory: async () => ({ tasks: { getTask: async () => ({ meta }), readVersionText: async () => '可上传的 AI 文案', updateTaskMeta: async (_username, _id, patch) => Object.assign(meta, patch), appendSiteSubmitLog: async (_username, _id, entry) => logs.push(entry), listTasks: async () => [{ ...meta }] }, config, configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => [] } })
  }));
  const response = await request(app, '/api/batch-rewrite/web-submit/submit', { mode: 'selected', ids: ['2071717253981255675'], versions: ['ai1'] });
  assert.equal(response.status, 200);
  assert.equal(response.body.failed_groups, 1);
  assert.equal(response.body.accepted_groups, 0);
  assert.match(response.body.groups[0].items[0].error, /文件名必须是纯数字/);
  assert.equal(logs[0].status, 'failed');
});

test('121 明确返回成功文件时可确认提交', async () => {
  const meta = { bookId: '2071717253981255675', platformId: '2', platformName: '番茄付费', gender: '女频', style: '现代女主', siteSubmitDoneVersions: [], siteSubmitAcceptedVersions: [] };
  const logs = [];
  const config = { web_submit: { ...organizationConfig, enabled: true, submit_versions: ['ai1'], advanced: { jieyaNum: 4, gunpingNum: 4 }, upload_profiles: [defaultVersionProfile], profile_bindings: { ai1: '121-default' } }, platforms: [], styles: [] };
  const app = express().use(express.json()).use('/api/batch-rewrite', createBatchRewriteRouter({
    auth: (req, res, next) => { req.username = 'writer-a'; next(); }, novelFetchStore: { getSession: () => ({ cookie: 'session=yes' }) }, knowledgeStore: { list: () => ({}) }, openingStore: {},
    httpClient: async () => ({ body: JSON.stringify({ success: true, result: { success: { count: 1, files: [{ name: '2071717253981255675.txt' }] }, failed: { count: 0, files: [] } } }), headers: {} }),
    tasksFactory: async () => ({ tasks: { getTask: async () => ({ meta }), readVersionText: async () => '可上传的 AI 文案', updateTaskMeta: async (_username, _id, patch) => Object.assign(meta, patch), appendSiteSubmitLog: async (_username, _id, entry) => logs.push(entry), listTasks: async () => [{ ...meta }] }, config, configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => [] } })
  }));
  const response = await request(app, '/api/batch-rewrite/web-submit/submit', { mode: 'selected', ids: ['2071717253981255675'], versions: ['ai1'] });
  assert.equal(response.status, 200);
  assert.equal(response.body.success_groups, 1);
  assert.equal(response.body.accepted_groups, 0);
  assert.deepEqual(meta.siteSubmitDoneVersions, ['ai1']);
  assert.deepEqual(logs[0].execution_trace.map(item => item.step), ['本地参数校验', '准备上传文件', '调用 121 上传接口', '121 文件处理结果', '121 后台记录核验']);
});

test('网站提交会先标记排队，再标记上传中，完成后标记已提交', async () => {
  const metas = new Map([
    ['2071717253981255675', { bookId: '2071717253981255675', platformId: '2', platformName: '番茄付费', gender: '女频', style: '现代女主', siteSubmitDoneVersions: [], siteSubmitAcceptedVersions: [], siteSubmitFailedVersions: [] }],
    ['2071717253981255676', { bookId: '2071717253981255676', platformId: '2', platformName: '番茄付费', gender: '女频', style: '现代女主', siteSubmitDoneVersions: [], siteSubmitAcceptedVersions: [], siteSubmitFailedVersions: [] }]
  ]);
  const patches = [];
  const config = { web_submit: { ...organizationConfig, enabled: true, submit_versions: ['ai1'], advanced: { jieyaNum: 4, gunpingNum: 4 }, upload_profiles: [defaultVersionProfile], profile_bindings: { ai1: '121-default' } }, platforms: [], styles: [] };
  const app = express().use(express.json()).use('/api/batch-rewrite', createBatchRewriteRouter({
    auth: (req, res, next) => { req.username = 'writer-a'; next(); },
    novelFetchStore: { getSession: () => ({ cookie: 'session=yes' }) }, knowledgeStore: { list: () => ({}) }, openingStore: {},
    httpClient: async () => ({ body: JSON.stringify({ success: true, result: { success: { count: 1, files: [{ name: 'ok.txt' }] }, failed: { count: 0, files: [] } } }), headers: {} }),
    tasksFactory: async () => ({
      tasks: {
        getTask: async (_user, id) => ({ meta: metas.get(id) }),
        readVersionText: async () => '可上传文案',
        updateTaskMeta: async (_user, id, patch) => { patches.push({ id, patch }); Object.assign(metas.get(id), patch); },
        appendSiteSubmitLog: async () => {},
        listTasks: async () => [...metas.values()]
      },
      config,
      configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => [] }
    })
  }));
  const response = await request(app, '/api/batch-rewrite/web-submit/submit', { mode: 'selected', ids: [...metas.keys()], versions: ['ai1'] });
  assert.equal(response.status, 200);
  assert.equal(patches[0].patch.siteSubmitStatus, 'queued');
  assert.equal(patches[1].patch.siteSubmitStatus, 'queued');
  assert.ok(patches.some(item => item.patch.siteSubmitStatus === 'uploading'));
  assert.equal([...metas.values()][0].siteSubmitStatus, 'submitted');
  assert.equal([...metas.values()][1].siteSubmitStatus, 'submitted');
});

test('敏感词普通替换会写入真实任务记录，并可由敏感日志读取', async () => {
  const meta = { bookId: 'book-sensitive', bookName: '敏感词示例', platformId: '2', gender: '女频', style: '现代女主' };
  let original = '这是一句敏感词原文。';
  const logs = [];
  const config = {
    layout: { apply_sensitive: true },
    sensitive_ai: { enabled: false, context_chars: 8 },
    sensitive: { groups: [{ name: '默认', enabled: true, apply_to_original: true, rules: [{ find: '敏感词', replace: '合规表达', enabled: true }] }] },
    knowledge: { layout_rules: { apply_sensitive_replace: true } },
    platforms: [], styles: []
  };
  const app = express().use(express.json()).use('/api/batch-rewrite', createBatchRewriteRouter({
    auth: (req, res, next) => { req.username = 'writer-a'; next(); },
    knowledgeStore: { list: () => ({}) }, openingStore: {},
    tasksFactory: async () => ({
      tasks: {
        getTask: async () => ({ meta }), fetchOriginal: async () => ({ status: 'done' }),
        readOriginal: async () => original,
        saveOriginalText: async (_username, _id, text) => { original = text; },
        updateTaskMeta: async (_username, _id, patch) => Object.assign(meta, patch),
        appendLog: async (_username, _id, event, data) => logs.push({ event, data }),
        readLogs: async () => logs,
        listTasks: async () => [{ ...meta }]
      }, config,
      configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => [] }
    })
  }));

  const fetchResponse = await request(app, '/api/batch-rewrite/tasks/book-sensitive/fetch', {});
  assert.equal(fetchResponse.status, 200);
  assert.equal(original, '这是一句合规表达原文。');
  assert.equal(meta.sensitiveHitCount, 1);
  assert.equal(meta.sensitiveFixedCount, 1);
  assert.equal(logs[0].event, 'sensitive_processed');
  const logResponse = await request(app, '/api/batch-rewrite/tasks/book-sensitive/sensitive-log', undefined, 'GET');
  assert.equal(logResponse.status, 200);
  assert.equal(logResponse.body.sensitive_hits.hit_count, 1);
  assert.equal(logResponse.body.sensitive_fixed.fixed_count, 1);
});

test('处理请求的敏感词 AI 开关关闭时覆盖旧配置并直接替换', async () => {
  const meta = { bookId: 'book-sensitive-override', bookName: '敏感词开关示例', platformId: '2', gender: '女频', style: '现代女主' };
  let original = '这是一句敏感词原文。';
  const logs = [];
  const config = {
    layout: { apply_sensitive: true },
    sensitive_ai: { enabled: true, context_chars: 8 },
    sensitive: { groups: [{ name: '默认', enabled: true, apply_to_original: true, apply_to_ai: true, rules: [{ find: '敏感词', replace: '合规表达', enabled: true }] }] },
    knowledge: { layout_rules: { apply_sensitive_replace: true } },
    platforms: [], styles: []
  };
  const app = express().use(express.json()).use('/api/batch-rewrite', createBatchRewriteRouter({
    auth: (req, res, next) => { req.username = 'writer-a'; next(); },
    knowledgeStore: { list: () => ({}) }, openingStore: {},
    tasksFactory: async () => ({
      tasks: {
        getTask: async () => ({ meta }),
        fetchOriginal: async () => ({ status: 'done' }),
        readOriginal: async () => original,
        saveOriginalText: async (_username, _id, text) => { original = text; },
        updateTaskMeta: async (_username, _id, patch) => Object.assign(meta, patch),
        appendLog: async (_username, _id, event, data) => logs.push({ event, data }),
        readLogs: async () => logs,
        listTasks: async () => [{ ...meta }]
      },
      config,
      configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => [] }
    })
  }));

  const response = await request(app, '/api/batch-rewrite/tasks/book-sensitive-override/fetch', { sensitive_ai_enabled: false });

  assert.equal(response.status, 200);
  assert.equal(original, '这是一句合规表达原文。');
  assert.equal(meta.sensitiveMode, 'replace');
  assert.equal(logs[0].data.mode, 'replace');
});

test('121 配置档与风格同步会读取真实远端结构，而不是返回空成功', async () => {
  const config = { web_submit: { enabled: true, upload_profiles: [] }, styles: ['旧风格'], platforms: [] };
  const customPage = '<label>组织归属<select name="organization_id"><option value="">请选择组织归属</option><option value="7">第一组织</option><option value="12">第二组织</option></select></label><select id="style"><option value="">请选择风格</option><option value="306">现代女主</option><option value="901">新风格</option></select>';
  const app = express().use(express.json()).use('/api/batch-rewrite', createBatchRewriteRouter({
    auth: (req, res, next) => { req.username = 'writer-a'; next(); },
    novelFetchStore: { getSession: () => ({ cookie: 'session=yes' }) }, knowledgeStore: { list: () => ({}) }, openingStore: {},
    httpClient: async ({ url }) => ({ body: url.includes('zdy_config.php')
      ? JSON.stringify({ success: true, data: [{ id: 7, config_name: '121 默认档', is_default: 1, config_data: JSON.stringify({ platform_id: '2', gender: '2', style: '306', jieya: { jieya_num: 3, speed: 1.8 }, gunping: { gunping_num: 5, ziti: 6, speed: 1.1 } }) }] })
      : customPage, headers: {} }),
    tasksFactory: async () => ({
      tasks: { saveConfig: async value => Object.assign(config, value), listTasks: async () => [] },
      config,
      configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => config.styles }
    })
  }));
  const profiles = await request(app, '/api/batch-rewrite/web-submit/sync-configs', {});
  assert.equal(profiles.status, 200);
  assert.equal(profiles.body.groups[0].name, '121 默认档');
  assert.equal(profiles.body.groups[0].advanced.jieyaNum, 3);
  assert.equal(profiles.body.groups[0].advanced.gunpingNum, 5);
  assert.deepEqual(profiles.body.organizations, {
    field_name: 'organization_id',
    options: [{ id: '7', name: '第一组织' }, { id: '12', name: '第二组织' }]
  });
  const styles = await request(app, '/api/batch-rewrite/web-submit/sync-styles', {});
  assert.equal(styles.status, 200);
  assert.deepEqual(styles.body.styles, ['现代女主', '新风格']);
  assert.deepEqual(config.styles, ['现代女主', '新风格']);
});

test('121 级联组织控件使用 organization 字段，不会误抓性别选项', async () => {
  const config = { web_submit: { enabled: true, upload_profiles: [] }, styles: [], platforms: [] };
  const customPage = '<form id="uploadForm"><label>平台<select id="platformSelect"><option value="1">黑岩付费</option><option value="2">番茄付费</option></select></label><div id="uploadOrganizationCascade"><select class="upload-form-select" data-organization-level="all"><option value="">请选择组织归属</option><option value="1">博量(层1)</option><option value="7">景耀组织(层2)</option><option value="2">俊华组织(层2)</option></select></div><input type="hidden" id="uploadOrganization" required><label>性别<select id="gender"><option value="1">男</option><option value="2">女</option></select></label></form>';
  const app = express().use(express.json()).use('/api/batch-rewrite', createBatchRewriteRouter({
    auth: (req, res, next) => { req.username = 'writer-org'; next(); },
    novelFetchStore: { getSession: () => ({ cookie: 'session=yes' }) }, knowledgeStore: { list: () => ({}) }, openingStore: {},
    httpClient: async ({ url }) => ({ body: url.includes('zdy_config.php') ? JSON.stringify({ success: true, data: [] }) : customPage, headers: {} }),
    tasksFactory: async () => ({ tasks: { saveConfig: async value => Object.assign(config, value), listTasks: async () => [] }, config, configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => [] } })
  }));
  const response = await request(app, '/api/batch-rewrite/web-submit/sync-configs', {});
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.organizations, { field_name: 'organization', options: [{ id: '1', name: '博量(层1)' }, { id: '7', name: '景耀组织(层2)' }, { id: '2', name: '俊华组织(层2)' }] });
});

test('121 动态组织接口没有 HTML 下拉时仍能同步组织归属', async () => {
  const config = { web_submit: { enabled: true, upload_profiles: [] }, styles: [], platforms: [] };
  const page = '<form><div id="uploadOrganizationCascade"></div><input type="hidden" id="uploadOrganization"><select id="style"><option value="306">现代女主</option></select></form>';
  const app = express().use(express.json()).use('/api/batch-rewrite', createBatchRewriteRouter({
    auth: (req, res, next) => { req.username = 'writer-dynamic-org'; next(); },
    novelFetchStore: { getSession: () => ({ cookie: 'session=yes' }) }, knowledgeStore: { list: () => ({}) }, openingStore: {},
    httpClient: async ({ url }) => ({
      body: url.includes('zdy_config.php')
        ? JSON.stringify({ success: true, data: [{ id: 7, config_name: '121 默认档', config_data: '{}' }] })
          : url.includes('organization.php')
          ? JSON.stringify({ success: true, data: [{ id: 1, parent_id: 0, level: 1, name: '博量', status: 'ENABLE' }, { id: 7, parent_id: 1, level: 2, name: '景耀组织', status: 'ENABLE' }] })
          : page,
      headers: {}
    }),
    tasksFactory: async () => ({ tasks: { saveConfig: async value => Object.assign(config, value), listTasks: async () => [] }, config, configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => [] } })
  }));
  const response = await request(app, '/api/batch-rewrite/web-submit/sync-configs', {});
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.organizations, { field_name: 'organization', options: [{ id: '1', name: '博量(层1)' }, { id: '7', name: '景耀组织(层2)' }] });
});

test('动态组织接口暂不可用时保留旧页面的组织同步兼容', async () => {
  const config = { web_submit: { enabled: true, upload_profiles: [] }, styles: [], platforms: [] };
  const page = '<label>组织归属<select name="organization"><option value="7">第一组织</option></select></label><select id="style"><option value="306">现代女主</option></select>';
  const app = express().use(express.json()).use('/api/batch-rewrite', createBatchRewriteRouter({
    auth: (req, res, next) => { req.username = 'writer-org-fallback'; next(); },
    novelFetchStore: { getSession: () => ({ cookie: 'session=yes' }) }, knowledgeStore: { list: () => ({}) }, openingStore: {},
    httpClient: async ({ url }) => {
      if (url.includes('organization.php')) throw new Error('organization service unavailable');
      return { body: url.includes('zdy_config.php') ? JSON.stringify({ success: true, data: [] }) : page, headers: {} };
    },
    tasksFactory: async () => ({ tasks: { saveConfig: async value => Object.assign(config, value), listTasks: async () => [] }, config, configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => [] } })
  }));
  const response = await request(app, '/api/batch-rewrite/web-submit/sync-configs', {});
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.organizations, { field_name: 'organization', options: [{ id: '7', name: '第一组织' }] });
});
