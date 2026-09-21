const test = require('node:test');
const assert = require('node:assert/strict');
const { writeModelAudit } = require('../lib/novel-fetch-workshop/run-audit');

test('execution audit contains model identity but never credential settings', async () => {
  const records = [];
  await writeModelAudit({ writeRunAudit: async record => records.push(record) }, {
    bookId: 'book-1', stage: 'rewrite', status: 'succeeded', attempts: 1,
    settings: { textModelId: 'gemini-3', modelDisplayName: 'Gemini 3', model: 'gemini-3', api_key: 'secret' }
  });
  assert.equal(records.length, 1);
  assert.deepEqual(Object.keys(records[0]).sort(), ['attempts', 'bookId', 'errorMessage', 'finishedAt', 'modelDisplayName', 'modelId', 'runId', 'stage', 'status', 'textModelId']);
  assert.equal(records[0].modelId, 'gemini-3');
  assert.equal(JSON.stringify(records[0]).includes('secret'), false);
});

test('execution audit is skipped without a resolved catalog model', async () => {
  let called = false;
  await writeModelAudit({ writeRunAudit: async () => { called = true; } }, { bookId: 'book-1', stage: 'rewrite', settings: {} });
  assert.equal(called, false);
});
