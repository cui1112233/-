const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function auditBatchName(now = new Date(), existingBatchIds, randomSource = crypto.randomBytes) {
  const part = value => String(value).padStart(2, '0');
  if (!Array.isArray(existingBatchIds)) throw new Error('existingBatchIds is required for isolation');
  const stem = `E2E-AUDIT-${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}-${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}`;
  const used = new Set(existingBatchIds);
  let candidate;
  do candidate = `${stem}-${randomSource(3).toString('hex')}`;
  while (used.has(candidate));
  return candidate;
}

function createAuditEvidence(batchName = auditBatchName(new Date(), [])) {
  if (!/^E2E-AUDIT-\d{8}-\d{6}-[a-z0-9]{6}$/.test(batchName)) throw new Error('batchName must be an isolated E2E-AUDIT name');
  const records = [];
  return {
    batchName,
    records,
    recordGate(gate, input, response, persisted, nextAction) {
      if (!gate) throw new Error('gate is required');
      if (!input || typeof input !== 'object') throw new Error('input is required');
      for (const field of ['batchId', 'bookId', 'videoId']) {
        if (!(field in input) || input[field] === undefined || input[field] === null || (field !== 'videoId' && !String(input[field]).trim())) throw new Error(`${field} is required`);
      }
      if (!response || typeof response !== 'object' || !Number.isInteger(response.status) || response.status < 100 || response.status > 599 || !response.body || typeof response.body !== 'object' || Array.isArray(response.body) || !Object.keys(response.body).length) throw new Error('response API evidence is required (status/body)');
      if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted) || !Object.keys(persisted).length || !('batchId' in persisted) || !('bookId' in persisted) || !('videoId' in persisted)) throw new Error('persisted evidence is required');
      for (const field of ['batchId', 'bookId']) {
        if (persisted[field] === undefined || persisted[field] === null || !String(persisted[field]).trim()) throw new Error(`persisted.${field} is required`);
      }
      for (const field of ['batchId', 'bookId', 'videoId']) if (String(input[field]) !== String(persisted[field])) throw new Error(`${field} 一致性校验失败`);
      const record = { gate, input, response, persisted, nextAction };
      records.push(record);
      return record;
    }
  };
}

test('E2E-AUDIT creates an isolated batch name absent from existing IDs', () => {
  const existingBatchIds = ['batch_abc123', 'batch_def456'];
  const batchName = auditBatchName(new Date(2026, 7, 28, 9, 7, 12), existingBatchIds);

  assert.match(batchName, /^E2E-AUDIT-20260828-090712-[a-z0-9]{6}$/);
  assert.equal(existingBatchIds.includes(batchName), false);
});

test('E2E-AUDIT retries deterministically when a generated name already exists', () => {
  const existingBatchIds = ['E2E-AUDIT-20260828-090712-a1b2c3'];
  const suffixes = ['a1b2c3', 'd4e5f6'];
  const batchName = auditBatchName(new Date(2026, 7, 28, 9, 7, 12), existingBatchIds, () => Buffer.from(suffixes.shift(), 'hex'));

  assert.equal(batchName, 'E2E-AUDIT-20260828-090712-d4e5f6');
});

test('E2E-AUDIT records a reusable gate evidence shape', () => {
  const evidence = createAuditEvidence('E2E-AUDIT-20260828-090712-a1b2c3');
  const record = evidence.recordGate(
    'create',
    { batchId: 'fixture-batch', bookId: 'fixture-book', videoId: '', title: 'audit fixture' },
    { status: 201, body: { id: 'fixture-batch' } },
    { batchId: 'fixture-batch', bookId: 'fixture-book', videoId: '', status: 'draft' },
    'start'
  );

  assert.deepEqual(record, {
    gate: 'create',
    input: { batchId: 'fixture-batch', bookId: 'fixture-book', videoId: '', title: 'audit fixture' },
    response: { status: 201, body: { id: 'fixture-batch' } },
    persisted: { batchId: 'fixture-batch', bookId: 'fixture-book', videoId: '', status: 'draft' },
    nextAction: 'start'
  });
  assert.deepEqual(evidence.records, [record]);
  assert.equal(evidence.batchName, 'E2E-AUDIT-20260828-090712-a1b2c3');
});

test('E2E-AUDIT rejects evidence without API or persistence proof', () => {
  const evidence = createAuditEvidence('E2E-AUDIT-20260828-090712-a1b2c3');
  assert.throws(() => evidence.recordGate('create', { batchId: 'b', bookId: 'k', videoId: '' }, {}, { batchId: 'b', bookId: 'k', videoId: '' }, 'start'), /response/);
  assert.throws(() => evidence.recordGate('create', { batchId: 'b', bookId: 'k', videoId: '' }, { status: 201, body: { ok: true } }, {}, 'start'), /persisted/);
  assert.throws(() => evidence.recordGate('create', { batchId: 'b', bookId: '', videoId: '' }, { status: 201, body: {} }, { batchId: 'b', bookId: 'k', videoId: '' }, 'start'), /bookId/);
  assert.throws(() => evidence.recordGate('create', { batchId: 'b', bookId: 'k', videoId: '' }, { status: 99, body: { ok: true } }, { batchId: 'b', bookId: 'k', videoId: '' }, 'start'), /status/);
  assert.throws(() => evidence.recordGate('create', { batchId: 'b', bookId: 'k', videoId: '' }, { status: 201, body: [] }, { batchId: 'b', bookId: 'k', videoId: '' }, 'start'), /body/);
  assert.throws(() => evidence.recordGate('create', { batchId: 'b', bookId: 'k', videoId: '' }, { status: 201, body: { ok: true } }, { batchId: 'other', bookId: 'k', videoId: '' }, 'start'), /一致/);
  assert.throws(() => evidence.recordGate('create', { batchId: 'b', bookId: 'k', videoId: null }, { status: 201, body: { ok: true } }, { batchId: 'b', bookId: 'k', videoId: '' }, 'start'), /videoId/);
});

module.exports = { auditBatchName, createAuditEvidence };
