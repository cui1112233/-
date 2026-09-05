const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createBatchFactoryV11Router } = require('../routes/batch-factory-v11');

async function request(router, body, username = 'alice') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.username = username; next(); });
  app.use('/api/batch-factory/v11', router);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  try {
    return await fetch(`http://127.0.0.1:${port}/api/batch-factory/v11/manual/skills/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('V11 router serves direct skill preview without proxying to Go', async () => {
  const response = await request(createBatchFactoryV11Router({
    manualSkillProcessor: {
      preview: async ({ username, items, skillIds }) => ({
        username,
        skillIds,
        allSucceeded: true,
        items: items.map((item, index) => ({ index, title: item.title, status: 'ready', processedText: item.sourceText }))
      })
    },
    fetchImpl: async () => { throw new Error('proxy must not be called'); }
  }), { items: [{ title: 'A', sourceText: '正文' }], skillIds: [] });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.allSucceeded, true);
  assert.equal(payload.items[0].processedText, '正文');
});

test('V11 router returns service unavailable when the skill processor is not wired', async () => {
  const response = await request(createBatchFactoryV11Router({ fetchImpl: async () => { throw new Error('must not proxy'); } }), {
    items: [{ title: 'A', sourceText: '正文' }], skillIds: []
  });
  assert.equal(response.status, 503);
});
