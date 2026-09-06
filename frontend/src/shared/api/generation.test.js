import test from 'node:test';
import assert from 'node:assert/strict';

import { constraintsForScriptAiContext } from './generation.js';

test('shotlist AI context always carries extracted people/scenes without mutating the UI constraint state', () => {
  const constraints = {
    enabled: false,
    baseSetup: { enabled: false, source: 'system', presetId: '', body: '' },
    prefix: { enabled: false }
  };

  const aiConstraints = constraintsForScriptAiContext('shotlist', constraints);

  assert.equal(aiConstraints.baseSetup.enabled, true);
  assert.equal(constraints.baseSetup.enabled, false);
  assert.notEqual(aiConstraints, constraints);
  assert.notEqual(aiConstraints.baseSetup, constraints.baseSetup);
});

test('non-shotlist formats preserve the caller constraint object', () => {
  const constraints = { baseSetup: { enabled: false } };
  assert.equal(constraintsForScriptAiContext('shortdrama', constraints), constraints);
});
