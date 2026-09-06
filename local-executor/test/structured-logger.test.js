const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createJsonlLogger } = require('../src/structured-logger');

test('structured executor logger writes one redacted JSONL event', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yizhan-executor-log-'));
  const filePath = path.join(dir, 'logs', 'executor-events.jsonl');
  const logger = createJsonlLogger({
    filePath,
    now: () => new Date('2026-09-06T08:10:00.000Z')
  });

  await logger.event('JOB_CLAIMED', {
    jobId: 'job-1',
    accountId: 'account-1',
    stage: 'leased',
    prompt: '绝不能写入日志的完整提示词',
    token: 'executor-secret',
    leaseToken: 'lease-secret',
    cookie: 'session=secret',
    authorization: 'Bearer secret',
    downloadUrl: 'https://cdn.example/video.mp4?signature=secret',
    errorMessage: 'safe diagnostic message'
  });

  const lines = (await fs.readFile(filePath, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]);
  assert.deepEqual(event, {
    timestamp: '2026-09-06T08:10:00.000Z',
    event: 'JOB_CLAIMED',
    jobId: 'job-1',
    accountId: 'account-1',
    stage: 'leased',
    errorMessage: 'safe diagnostic message'
  });
  const raw = lines[0];
  for (const secret of ['绝不能写入日志的完整提示词', 'executor-secret', 'lease-secret', 'session=secret', 'Bearer secret', 'signature=secret']) {
    assert.equal(raw.includes(secret), false);
  }
});

test('structured executor logger bounds diagnostic strings and ignores unknown fields', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yizhan-executor-log-'));
  const filePath = path.join(dir, 'events.jsonl');
  const logger = createJsonlLogger({ filePath });
  await logger.event('JOB_FAILED', {
    jobId: 'job-2',
    errorCode: 'ACCEPTANCE_UNKNOWN',
    errorMessage: 'x'.repeat(2000),
    arbitrary: 'must-drop'
  });
  const event = JSON.parse((await fs.readFile(filePath, 'utf8')).trim());
  assert.equal(event.errorMessage.length <= 512, true);
  assert.equal(Object.hasOwn(event, 'arbitrary'), false);
});
