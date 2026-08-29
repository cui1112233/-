const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  createBatchFactorySettingsHydrationRouter
} = require('../routes/batch-factory-settings-hydration');

function testAuth(req, _res, next) {
  req.username = 'tester';
  req.auth = { account: { username: 'tester', isOwner: false } };
  next();
}

function legacyBatch() {
  return {
    id: 'batch-1',
    settings: { aspectRatio: '9:16', quality: '旧批次画质' },
    items: [{
      id: 'item-1',
      settingsOverride: { quality: '旧小说覆盖', qualityEnabled: false },
      videoSettingsOverrides: {
        '1': { restriction: '旧 VIDEO 限制', negativeEnabled: false }
      }
    }]
  };
}

async function request(router) {
  const app = express();
  app.use(router);
  app.get('/batches/:batchId', (_req, res) => res.json({ ok: true }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const { port } = server.address();
    return await fetch(`http://127.0.0.1:${port}/batches/batch-1`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('首次访问旧批次时三层 legacy 设置整体 bootstrap 到 Go/MySQL', async () => {
  const batch = legacyBatch();
  const calls = [];
  const router = createBatchFactorySettingsHydrationRouter({
    authenticate: testAuth,
    store: { getBatch: () => batch },
    loadState: async () => ({ persisted: false, state: {} }),
    bootstrapState: async payload => {
      calls.push(payload);
      return { persisted: true, state: payload.state };
    }
  });

  const response = await request(router);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    username: 'tester',
    isOwner: false,
    batchId: 'batch-1',
    state: {
      settings: { aspectRatio: '9:16', quality: '旧批次画质' },
      itemOverrides: {
        'item-1': { quality: '旧小说覆盖', qualityEnabled: false }
      },
      videoOverrides: {
        'item-1': {
          '1': { restriction: '旧 VIDEO 限制', negativeEnabled: false }
        }
      }
    },
    shuihuoGateway: undefined
  });
});

test('MySQL 已接管的批次不重复 bootstrap legacy JSON', async () => {
  let bootstraps = 0;
  const router = createBatchFactorySettingsHydrationRouter({
    authenticate: testAuth,
    store: { getBatch: () => legacyBatch() },
    loadState: async () => ({ persisted: true, state: { settings: { aspectRatio: '16:9' } } }),
    bootstrapState: async () => { bootstraps += 1; return {}; }
  });

  const response = await request(router);
  assert.equal(response.status, 200);
  assert.equal(bootstraps, 0);
});
