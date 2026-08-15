const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { createScriptConstraintPromptsRouter } = require('../routes/script-constraint-prompts');

function appFor(username = 'alice') {
  const promptStore = {
    createOrSaveDraft(owner, input) { return { id: '11111111-1111-4111-8111-111111111111', username: owner, ...input }; },
    list() { return []; }, getOwned() { return null; }, update() { return null; }, remove() { return false; }, markUsed() { return false; }
  };
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.username = username; next(); });
  app.use(createScriptConstraintPromptsRouter({ promptStore, skipAuth: true }));
  return app;
}

test('personal prompt API saves only the authenticated account', async () => {
  const response = await new Promise(resolve => {
    const server = appFor().listen(0, async () => {
      const result = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'bob', category: 'prefix', name: null, body: '我的正文' }) });
      resolve({ status: result.status, body: await result.json(), server });
    });
  });
  response.server.close();
  assert.equal(response.status, 201);
  assert.equal(response.body.prompt.username, 'alice');
});
