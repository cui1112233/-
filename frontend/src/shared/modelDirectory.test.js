import test from 'node:test';
import assert from 'node:assert/strict';
import { filterEnabledModels, filterCompatibleVideoModels } from './modelDirectory.js';

test('model selectors keep only enabled models of the requested capability', () => {
  const models = [
    { id: 'text-1', kind: 'text', enabled: true },
    { id: 'video-on', kind: 'video', enabled: true },
    { id: 'video-off', kind: 'video', enabled: false },
    { id: 'image-1', kind: 'image', enabled: true }
  ];

  assert.deepEqual(filterEnabledModels(models, 'video').map(model => model.id), ['video-on']);
  assert.deepEqual(filterEnabledModels(models).map(model => model.id), ['text-1', 'video-on', 'image-1']);
});

test('batch video compatibility never reintroduces disabled or non-video entries', () => {
  const models = [
    { id: 1, kind: 'video', enabled: true, maxVideoDuration: 15, requiresImageInput: false },
    { id: 2, kind: 'video', enabled: false, maxVideoDuration: 15, requiresImageInput: false },
    { id: 3, kind: 'text', enabled: true, maxVideoDuration: 15, requiresImageInput: false },
    { id: 4, kind: 'video', enabled: true, maxVideoDuration: 5, requiresImageInput: false }
  ];

  assert.deepEqual(filterCompatibleVideoModels(models, { settings: { maxVideoDuration: 10 } }).map(model => model.id), [1]);
});
