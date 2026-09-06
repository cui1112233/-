const fs = require('node:fs/promises');
const path = require('node:path');

const STRING_FIELDS = new Map([
  ['jobId', 191],
  ['executorId', 191],
  ['accountId', 191],
  ['submissionId', 191],
  ['mediaId', 191],
  ['artifactId', 191],
  ['stage', 64],
  ['errorCode', 96],
  ['errorMessage', 512],
  ['model', 96],
  ['ratio', 32]
]);

const NUMBER_FIELDS = new Set([
  'attempt',
  'recovery',
  'duration',
  'imageCount',
  'promptLength'
]);

function createJsonlLogger({ filePath, now = () => new Date(), appendFile = fs.appendFile, mkdir = fs.mkdir } = {}) {
  const target = String(filePath || '').trim();
  if (!target) throw new Error('structured log filePath is required');
  let tail = Promise.resolve();

  return {
    event(eventName, fields = {}) {
      const record = buildLogRecord(eventName, fields, now);
      const write = tail.then(async () => {
        await mkdir(path.dirname(target), { recursive: true });
        await appendFile(target, `${JSON.stringify(record)}\n`, 'utf8');
      });
      tail = write.catch(() => {});
      return write;
    }
  };
}

function buildLogRecord(eventName, fields = {}, now = () => new Date()) {
  const event = String(eventName || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(event)) throw new Error('invalid structured log event');
  const timestamp = normalizeTimestamp(now());
  const record = { timestamp, event };

  for (const [field, maxLength] of STRING_FIELDS) {
    if (fields[field] === null || fields[field] === undefined) continue;
    const value = String(fields[field]).trim();
    if (!value) continue;
    record[field] = value.slice(0, maxLength);
  }
  for (const field of NUMBER_FIELDS) {
    const value = Number(fields[field]);
    if (Number.isFinite(value)) record[field] = value;
  }
  return record;
}

function normalizeTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

module.exports = { createJsonlLogger, buildLogRecord };
