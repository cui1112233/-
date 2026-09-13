import test from 'node:test';
import assert from 'node:assert/strict';
import { workshopPlatformsPath } from './novelFetchWorkshop.js';

test('Novel Fetch platform reader uses the dedicated platform endpoint', () => {
  assert.equal(workshopPlatformsPath(), '/api/novel-fetch-workshop/platforms');
});
