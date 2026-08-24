const express = require('express');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBatchRewriteRouter } = require('../routes/batch-rewrite');

async function request(app, path, body) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('网站提交预览会按同一本书的已选文案均分 8 个素材', async () => {
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
      upload_profiles: [{ id: 'ai2-fast', name: 'AI2 快速配置', advanced: { jieyaSpeed: 1.9, ziti: 6 } }],
      profile_bindings: { ai2: 'ai2-fast' }
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
  assert.deepEqual(allocations, [['ai1', 2, 2], ['ai2', 2, 2]]);
  const ai2 = response.body.groups.flatMap(group => group.items).find(item => item.version === 'ai2');
  assert.equal(ai2.profile_name, 'AI2 快速配置');
  assert.equal(ai2.advanced.jieyaSpeed, 1.9);
  assert.equal(ai2.advanced.ziti, 6);
  assert.equal(ai2.advanced.keywords, '全局关键词');
});
