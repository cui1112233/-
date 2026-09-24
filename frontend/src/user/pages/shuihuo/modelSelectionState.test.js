import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedModelState } from './modelSelectionState.js';

const models = [
  { id: 'gpt-54', displayName: 'GPT-5.4', modelId: 'gpt-5.4' }
];

test('reports the selected available model by its display name', () => {
  assert.deepEqual(selectedModelState(models, 'gpt-54'), {
    state: 'available',
    label: '当前生效：GPT-5.4'
  });
});

test('reports a saved model that is no longer available without exposing its id', () => {
  assert.deepEqual(selectedModelState(models, 'retired-text-model'), {
    state: 'unavailable',
    label: '当前选择的文本模型已不可用，请重新选择'
  });
});
