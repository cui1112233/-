const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  runSourceWorkflow,
  createSourceFetchOriginal,
  SOURCE_STATES,
  SOURCE_CODES
} = require('../lib/novel-fetch-workshop/source-workflow');

function acceptedSubmit() {
  return { outcome: 'accepted', remoteTaskId: 'job-1' };
}

test('source workflow completes only after accepted -> poll -> result -> download -> verified save', async () => {
  const calls = [];
  const pollStates = ['queued', 'running', 'result_ready'];
  const result = await runSourceWorkflow({
    bookId: '10001',
    platformId: '2',
    maxTxt: 4000,
    adapters: {
      async submit(input) { calls.push(['submit', input.bookId]); return acceptedSubmit(); },
      async poll(input) { calls.push(['poll', input.remoteTaskId]); return { outcome: pollStates.shift() }; },
      async result(input) { calls.push(['result', input.remoteTaskId]); return { outcome: 'result_ready', downloadRef: { opaqueId: 'result-1' } }; },
      async download(input) { calls.push(['download', input.remoteTaskId, input.downloadRef.opaqueId]); return { outcome: 'downloaded', text: '正文内容' }; },
      async save(input) { calls.push(['save', input.remoteTaskId, input.text]); return { outcome: 'saved', verified: true }; }
    },
    maxPollAttempts: 5,
    sleep: async () => {}
  });

  assert.equal(result.status, 'done');
  assert.equal(result.sourceStatus, SOURCE_STATES.COMPLETED);
  assert.equal(result.remoteTaskId, 'job-1');
  assert.deepEqual(result.history, [
    SOURCE_STATES.SUBMITTED_TO_SOURCE,
    SOURCE_STATES.ACCEPTED,
    SOURCE_STATES.QUEUED,
    SOURCE_STATES.RUNNING,
    SOURCE_STATES.RESULT_READY,
    SOURCE_STATES.DOWNLOADED,
    SOURCE_STATES.SAVED,
    SOURCE_STATES.COMPLETED
  ]);
  assert.equal(calls.filter(item => item[0] === 'submit').length, 1);
  assert.ok(calls.filter(item => ['poll', 'result', 'download', 'save'].includes(item[0])).every(item => item[1] === 'job-1'));
});

test('submit rejection is a business failure even when the transport adapter returned normally', async () => {
  const result = await runSourceWorkflow({
    bookId: '10001', platformId: '2', maxTxt: 4000,
    adapters: { submit: async () => ({ outcome: 'rejected', message: '业务拒绝' }) }
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, SOURCE_CODES.SUBMIT_REJECTED);
  assert.equal(result.remoteTaskId, '');
});

test('accepted submit without a remote task id is protocol_error, never submitted', async () => {
  const result = await runSourceWorkflow({
    bookId: '10001', platformId: '2', maxTxt: 4000,
    adapters: { submit: async () => ({ outcome: 'accepted' }) }
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, SOURCE_CODES.PROTOCOL_ERROR);
  assert.notEqual(result.sourceStatus, 'submitted');
});

test('auth_expired before acceptance fails without inventing accepted_pending', async () => {
  const result = await runSourceWorkflow({
    bookId: '10001', platformId: '2', maxTxt: 4000,
    adapters: { submit: async () => ({ outcome: 'auth_expired' }) }
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, SOURCE_CODES.AUTH_EXPIRED);
});

test('external blockage after explicit acceptance remains accepted_pending and does not resubmit', async () => {
  let submits = 0;
  const result = await runSourceWorkflow({
    bookId: '10001', platformId: '2', maxTxt: 4000,
    adapters: {
      submit: async () => { submits += 1; return acceptedSubmit(); },
      poll: async () => ({ outcome: 'external_blocked', message: '暂不可达' })
    },
    sleep: async () => {}
  });
  assert.equal(submits, 1);
  assert.equal(result.status, 'accepted_pending');
  assert.equal(result.sourceStatus, SOURCE_STATES.ACCEPTED_PENDING);
  assert.equal(result.remoteTaskId, 'job-1');
  assert.equal(result.errorCode, SOURCE_CODES.EXTERNAL_BLOCKED);
});

test('queued/running poll exhaustion stays accepted_pending with timeout code', async () => {
  let polls = 0;
  const result = await runSourceWorkflow({
    bookId: '10001', platformId: '2', maxTxt: 4000,
    adapters: {
      submit: async () => acceptedSubmit(),
      poll: async () => ({ outcome: ++polls === 1 ? 'queued' : 'running' })
    },
    maxPollAttempts: 2,
    sleep: async () => {}
  });
  assert.equal(result.status, 'accepted_pending');
  assert.equal(result.errorCode, SOURCE_CODES.TASK_TIMEOUT);
  assert.equal(polls, 2);
});

test('terminal remote task failure is failed, not submitted', async () => {
  const result = await runSourceWorkflow({
    bookId: '10001', platformId: '2', maxTxt: 4000,
    adapters: {
      submit: async () => acceptedSubmit(),
      poll: async () => ({ outcome: 'failed', message: 'remote failed' })
    }
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, SOURCE_CODES.TASK_FAILED);
  assert.notEqual(result.sourceStatus, 'submitted');
});

test('result_ready without body or opaque download reference stays accepted_pending', async () => {
  const result = await runSourceWorkflow({
    bookId: '10001', platformId: '2', maxTxt: 4000,
    adapters: {
      submit: async () => acceptedSubmit(),
      poll: async () => ({ outcome: 'result_ready' }),
      result: async () => ({ outcome: 'result_ready' })
    }
  });
  assert.equal(result.status, 'accepted_pending');
  assert.equal(result.errorCode, SOURCE_CODES.RESULT_EMPTY);
});

test('download failure after acceptance remains accepted_pending', async () => {
  const result = await runSourceWorkflow({
    bookId: '10001', platformId: '2', maxTxt: 4000,
    adapters: {
      submit: async () => acceptedSubmit(),
      poll: async () => ({ outcome: 'result_ready' }),
      result: async () => ({ outcome: 'result_ready', downloadRef: { opaqueId: 'r1' } }),
      download: async () => ({ outcome: 'failed', message: 'download failed' })
    }
  });
  assert.equal(result.status, 'accepted_pending');
  assert.equal(result.errorCode, SOURCE_CODES.RESULT_DOWNLOAD_FAILED);
});

test('save must be verified before completed', async () => {
  const result = await runSourceWorkflow({
    bookId: '10001', platformId: '2', maxTxt: 4000,
    adapters: {
      submit: async () => acceptedSubmit(),
      poll: async () => ({ outcome: 'result_ready' }),
      result: async () => ({ outcome: 'result_ready', text: '正文' }),
      save: async () => ({ outcome: 'saved', verified: false })
    }
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, SOURCE_CODES.SAVE_FAILED);
  assert.notEqual(result.sourceStatus, SOURCE_STATES.COMPLETED);
});

test('sourceFetchOriginal falls back to the existing verified fetch path when no source adapter contract exists', async () => {
  const calls = [];
  const sourceFetchOriginal = createSourceFetchOriginal();
  const tasks = {
    async fetchOriginal(owner, bookId, maxTxt) { calls.push([owner, bookId, maxTxt]); return { status: 'done', attempts: 1 }; }
  };
  const result = await sourceFetchOriginal('alice', { tasks, task: { bookId: '10001', platformId: '2', maxTxt: 4000 } });
  assert.deepEqual(result, { status: 'done', attempts: 1 });
  assert.deepEqual(calls, [['alice', '10001', 4000]]);
});

test('source workflow implementation contains no guessed 121 source URL or zbooklist upload endpoint', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'novel-fetch-workshop', 'source-workflow.js'), 'utf8');
  assert.doesNotMatch(source, /two\.121w\.com/i);
  assert.doesNotMatch(source, /zbooklist_upload\.php/i);
  assert.doesNotMatch(source, /txt\.121w\.com\/api\.php/i);
  assert.doesNotMatch(source, /cookie|password|token/i);
});
