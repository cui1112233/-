import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBeijingDatetimeLocal, parseBeijingDatetimeLocal } from './batchFactoryAutomationSchedule.js';

test('converts a Beijing wall-clock scheduling value to a UTC instant', () => {
  assert.equal(parseBeijingDatetimeLocal('2026-09-25T03:00'), '2026-09-24T19:00:00.000Z');
});

test('formats a persisted UTC instant for the Beijing scheduling control', () => {
  assert.equal(formatBeijingDatetimeLocal('2026-09-24T19:00:00.000Z'), '2026-09-25T03:00');
});

test('rejects malformed scheduling values instead of silently using browser local time', () => {
  assert.equal(parseBeijingDatetimeLocal('2026/09/25 03:00'), '');
  assert.equal(formatBeijingDatetimeLocal('not-an-instant'), '');
});
