const test = require('node:test');
const assert = require('node:assert/strict');

function auditBatchName(now = new Date()) {
  const part = value => String(value).padStart(2, '0');
  return `E2E-AUDIT-${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}-${part(now.getHours())}${part(now.getMinutes())}`;
}

function createAuditEvidence(batchName = auditBatchName()) {
  const records = [];
  return {
    batchName,
    records,
    recordGate(gate, input, response, persisted, nextAction) {
      const record = { gate, input, response, persisted, nextAction };
      records.push(record);
      return record;
    }
  };
}

test('E2E-AUDIT creates an isolated batch name', () => {
  const batchName = auditBatchName(new Date(2026, 7, 28, 9, 7));

  assert.match(batchName, /^E2E-AUDIT-20260828-0907$/);
  assert.notEqual(batchName, 'batch-1');
  assert.notEqual(batchName, 'batch-2');
});

test('E2E-AUDIT records a reusable gate evidence shape', () => {
  const evidence = createAuditEvidence('E2E-AUDIT-20260828-0907');
  const record = evidence.recordGate(
    'create',
    { title: 'audit fixture' },
    { status: 201, body: { id: 'fixture-batch' } },
    { id: 'fixture-batch', status: 'draft' },
    'start'
  );

  assert.deepEqual(record, {
    gate: 'create',
    input: { title: 'audit fixture' },
    response: { status: 201, body: { id: 'fixture-batch' } },
    persisted: { id: 'fixture-batch', status: 'draft' },
    nextAction: 'start'
  });
  assert.deepEqual(evidence.records, [record]);
  assert.equal(evidence.batchName, 'E2E-AUDIT-20260828-0907');
});

module.exports = { auditBatchName, createAuditEvidence };
