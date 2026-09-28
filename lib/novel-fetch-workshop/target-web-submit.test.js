'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTargetAwareWebSubmit } = require('./target-web-submit');

test('target-aware wrapper preserves browser-backed actions for Batch Factory catalogs', async () => {
  const calls = [];
  const service = {
    workerAction: async (...args) => { calls.push(args); return { status: 200, body: '{"success":true}' }; },
    getConfig() {}, saveConfig() {}, environment() {}, testVisible() {}, syncConfigs() {},
    syncOrganizations() {}, syncStyles() {}, ensureSession() {}, preview() {}, submit() {}
  };
  const wrapped = createTargetAwareWebSubmit({ service, accountResolver: () => null, createStore: () => ({}) });

  const result = await wrapped.workerAction('owner-1', 'organization_list');

  assert.deepEqual(calls, [['owner-1', 'organization_list']]);
  assert.equal(result.status, 200);
});
