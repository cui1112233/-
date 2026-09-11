import assert from 'node:assert/strict';
import test from 'node:test';

import { createCustomModelId } from './customModelId.js';

test('custom model create payload receives a stable unused catalog id', () => {
  assert.equal(
    createCustomModelId({ displayName: 'GPT 5.4', modelId: 'gpt-5.4' }, ['custom-gpt-5-4']),
    'custom-gpt-5-4-2'
  );
});
