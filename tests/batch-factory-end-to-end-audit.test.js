const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function auditBatchName(now = new Date(), existingBatchIds = []) {
  const part = value => String(value).padStart(2, '0');
  const stem = `E2E-AUDIT-${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}-${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}`;
  const used = new Set(existingBatchIds);
  let candidate;
  do candidate = `${stem}-${crypto.randomBytes(3).toString('hex')}`;
  while (used.has(candidate));
  return candidate;
}

function createAuditEvidence(batchName = auditBatchName()) {
  if (!/^E2E-AUDIT-\d{8}-\d{6}-[a-z0-9]{6}$/.test(batchName)) throw new Error('batchName must be an isolated E2E-AUDIT name');
  const records = [];
  return {
    batchName,
    records,
    recordGate(gate, input, response, persisted, nextAction) {
      if (!gate) throw new Error('gate is required');
      if (!input || typeof input !== 'object') throw new Error('input is required');
      for (const field of ['batchId', 'bookId', 'videoId']) {
        if (!(field in input) || (field !== 'videoId' && !String(input[field]).trim())) throw new Error(`${field} is required`);
      }
      if (!response || typeof response !== 'object' || !Number.isInteger(response.status) || !('body' in response)) throw new Error('response API evidence is required');
      if (!persisted || typeof persisted !== 'object' || !('batchId' in persisted) || !('bookId' in persisted) || !('videoId' in persisted)) throw new Error('persisted evidence is required');
      for (const field of ['batchId', 'bookId']) {
        if (!String(persisted[field]).trim()) throw new Error(`persisted.${field} is required`);
      }
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
  assert.throws(() => evidence.recordGate('create', { batchId: 'b', bookId: 'k', videoId: '' }, { status: 201, body: {} }, {}, 'start'), /persisted/);
  assert.throws(() => evidence.recordGate('create', { batchId: 'b', bookId: '', videoId: '' }, { status: 201, body: {} }, { batchId: 'b', bookId: 'k', videoId: '' }, 'start'), /bookId/);
});

module.exports = { auditBatchName, createAuditEvidence };
