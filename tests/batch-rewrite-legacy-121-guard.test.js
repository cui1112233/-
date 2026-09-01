const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createBatchRewriteRouter } = require('../routes/batch-rewrite');

async function listen(app) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

function fixture() {
  let httpCalls = 0;
  const tasks = {
    async getConfig() { return { web_submit: { enabled: true, username: 'site-user' }, workflow: {} }; },
    async saveConfig() {},
    async listTasks() { return []; }
  };
  const router = createBatchRewriteRouter({
    auth(req, _res, next) {
      req.username = 'alice';
      req.auth = { account: { username: 'alice', isOwner: true } };
      next();
    },
    systemDir: '/tmp/qiantie-legacy-121-guard',
    tasksFactory: async () => ({
      tasks,
      config: { web_submit: { enabled: true, username: 'site-user' }, workflow: {} },
      configStore: {
        getConfig: () => ({ web_submit: { enabled: true, username: 'site-user' }, workflow: {} }),
        getPlatforms: () => [],
        getStyles: () => []
      }
    }),
    knowledgeStore: { list: () => [] },
    openingStore: {},
    novelFetchStore: {
      getSession: () => ({ cookie: 'legacy-cookie' }),
      getBrowserSession: () => null
    },
    httpClient: async () => {
      httpCalls += 1;
      return { status: 200, headers: {}, body: '{}' };
    }
  });
  const app = express();
  app.use(express.json());
  app.use(router);
  return { app, getHttpCalls: () => httpCalls };
}

for (const route of [
  '/web-submit/config',
  '/web-submit/sync-configs',
  '/web-submit/sync-styles',
  '/web-submit/test-visible',
  '/web-submit/submit'
]) {
  test(`legacy mutation ${route} is fail-closed instead of reaching direct 121 HTTP`, async () => {
    const f = fixture();
    const { server, base } = await listen(f.app);
    try {
      const response = await fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: { enabled: true, username: 'site-user', password: 'pw' }, mode: 'selected', ids: ['10001'] })
      });
      const body = await response.json();
      assert.equal(response.status, 410);
      assert.equal(body.code, 'legacy_121_mutation_disabled');
      assert.equal(f.getHttpCalls(), 0);
    } finally {
      server.close();
    }
  });
}
