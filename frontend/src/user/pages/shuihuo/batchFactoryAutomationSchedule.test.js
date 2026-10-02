import test from 'node:test';
import assert from 'node:assert/strict';
import { automationPresetSnapshot, formatBeijingDatetimeLocal, parseBeijingDatetimeLocal } from './batchFactoryAutomationSchedule.js';

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

test('freezes the selected automation preset configuration before a giant batch starts', () => {
  const presets = [{ id: 'preset-1', name: '全自动', version: 2, config: { textModelId: 'text-1', publishSettings: { organization: 'org-a' } } }];
  const snapshot = automationPresetSnapshot(presets, 'preset-1');
  presets[0].config.publishSettings.organization = 'changed-after-selection';

  assert.deepEqual(snapshot, {
    id: 'preset-1', name: '全自动', version: 2,
    config: { textModelId: 'text-1', publishSettings: { organization: 'org-a' } }
  });
  assert.equal(automationPresetSnapshot(presets, 'missing'), null);
});
