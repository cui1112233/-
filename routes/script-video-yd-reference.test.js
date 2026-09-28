const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createScriptVideoRouter } = require('./script-video');

test('script video sends asset images to YD image-to-video instead of rejecting them as unsupported references', async () => {
  let submitted;
  const router = createScriptVideoRouter({
    authenticate: (req, _res, next) => {
      req.username = 'owner';
      req.auth = { username: 'owner', account: { username: 'owner', isOwner: true } };
      next();
    },
    memberStore: { canUseApi: () => true },
    configReader: () => ({ video: { apiKey: 'yd-test-key' } }),
    submit: async options => {
      submitted = options;
      return { statusCode: 200, text: JSON.stringify({ task_id: 'yd-task-1' }) };
    }
  });
  const app = express();
  app.use(express.json());
  app.use('/api/script-video', router);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/script-video`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        modelKey: 'yd2-mini-video',
        prompt: '@妻子 转身看向镜头',
        imageUrls: ['https://assets.example/wife.png']
      })
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true, taskId: 'yd-task-1' });
    assert.deepEqual(submitted.payload.image_urls, [
      'https://tvmao-public.tos-cn-beijing.volces.com/tapnow/empty.png',
      'https://assets.example/wife.png'
    ]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
