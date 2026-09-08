'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { toV78Task } = require('../lib/novel-fetch-workshop/task-ops');
const versionSelection = require('../lib/novel-fetch-workshop/version-selection');

const root = path.resolve(__dirname, '..');

test('task API exposes the exact selected AI1-AI5 contract used by the workbench', () => {
  const task = toV78Task({
    bookId: 'book-1',
    targetVersions: ['original', 'ai2', 'ai5'],
    aiSlotMethodsSnapshot: {
      ai2: 'opening_instruction',
      ai5: 'instruction'
    },
    aiGeneratedVersions: ['ai2']
  });

  assert.deepEqual(task.selected_versions, ['original', 'ai2', 'ai5']);
  assert.deepEqual(task.ai_slot_methods, {
    ai2: 'opening_instruction',
    ai5: 'instruction'
  });
  assert.deepEqual(task.ai_files, ['ai2']);
});

test('batch rewrite route accepts selected versions and the shared normalizer preserves all six profile bindings', () => {
  const route = fs.readFileSync(path.join(root, 'routes/batch-rewrite.js'), 'utf8');
  const profileNormalizer = route.match(/function normalizeProfileBindings\(value\) \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(route, /selected_versions/);
  assert.match(route, /ai_slot_methods/);
  assert.match(profileNormalizer, /versionSelection\.normalizeProfileBindings/);
  assert.deepEqual(versionSelection.normalizeProfileBindings({
    original: 'p0',
    ai1: 'p1',
    ai2: 'p2',
    ai3: 'p3',
    ai4: 'p4',
    ai5: 'p5',
    ai6: 'ignored'
  }), {
    original: 'p0',
    ai1: 'p1',
    ai2: 'p2',
    ai3: 'p3',
    ai4: 'p4',
    ai5: 'p5'
  });
});
