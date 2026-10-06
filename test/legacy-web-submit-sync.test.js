const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { createBatchRewriteRouter } = require('../routes/batch-rewrite');

async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('legacy web-submit profile sync with persist false only returns remote profiles', async () => {
  const saved = [];
  const config = {
    web_submit: {
      enabled: true,
      upload_profiles: [{ id: 'local-1', name: 'Local profile', source: 'local' }]
    }
  };
  const tasks = {
    saveConfig: async value => saved.push(value),
    listTasks: async () => []
  };
  const app = express();
  app.use(express.json());
  app.use('/api/batch-rewrite', createBatchRewriteRouter({
    systemDir: '/tmp',
    auth: (req, _res, next) => { req.username = 'owner'; req.auth = { username: 'owner' }; next(); },
    tasksFactory: async () => ({ tasks, config, configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => [] } }),
    novelFetchStore: { getSession: () => ({ cookie: 'PHPSESSID=ready' }) },
    httpClient: async ({ url }) => ({
      body: url.includes('zdy_config')
        ? JSON.stringify({
          success: true,
          data: [{ id: '101', config_name: '121 男频档', config_data: JSON.stringify({ gender: '1', platform_id: '121' }) }]
        })
        : '<select id="style"><option value="8">古风</option></select>'
    })
  }));

  await withServer(app, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/batch-rewrite/web-submit/sync-configs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persist: false })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.groups[0].name, '121 男频档');
    assert.equal(saved.length, 0);
  });
});

test('legacy web-submit style sync with persist false only returns remote styles', async () => {
  const saved = [];
  const config = { web_submit: { enabled: true }, styles: ['旧风格'] };
  const tasks = { saveConfig: async value => saved.push(value), listTasks: async () => [] };
  const app = express();
  app.use(express.json());
  app.use('/api/batch-rewrite', createBatchRewriteRouter({
    systemDir: '/tmp',
    auth: (req, _res, next) => { req.username = 'owner'; req.auth = { username: 'owner' }; next(); },
    tasksFactory: async () => ({ tasks, config, configStore: { getConfig: () => config, getPlatforms: () => [], getStyles: () => [] } }),
    novelFetchStore: { getSession: () => ({ cookie: 'PHPSESSID=ready' }) },
    httpClient: async () => ({ body: '<select id="style"><option value="8">古风</option></select>' })
  }));

  await withServer(app, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/batch-rewrite/web-submit/sync-styles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persist: false })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload.styles, ['古风']);
    assert.equal(saved.length, 0);
  });
});
