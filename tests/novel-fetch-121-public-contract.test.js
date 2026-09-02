const test = require('node:test');
const assert = require('node:assert/strict');
const {
  publicWebSubmit,
  create121WebSubmitService
} = require('../lib/novel-fetch-workshop/121-web-submit-service');

test('121 public settings never expose a password field', () => {
  const settings = publicWebSubmit({
    enabled: true,
    username: 'target-user',
    password: 'secret',
    password_masked: true
  });
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'password'), false);
  assert.equal(settings.username, 'target-user');
  assert.equal(settings.password_masked, true);
});

test('121 submit response keeps V78 fields and also exposes ok and summary compatibility fields', async () => {
  const meta = {
    bookId: '10001',
    platformId: '2',
    gender: '男频',
    style: '男频都市',
    siteSubmitDoneVersions: [],
    siteSubmitAcceptedVersions: [],
    siteSubmitFailedVersions: []
  };
  const config = {
    web_submit: {
      enabled: true,
      username: 'target-user',
      password_masked: true,
      submit_versions: ['ai1'],
      skip_submitted: false,
      retry_times: 0,
      selected_profile: 'p1',
      upload_profiles: [{
        id: 'p1',
        name: '默认配置',
        enabled: true,
        platform_id: '2',
        gender: '男',
        style: '男频都市',
        is_default: true,
        advanced: {}
      }],
      style_catalog: [{ id: '305', name: '男频都市' }],
      advanced: {}
    }
  };
  const logs = [];
  const store = {
    async getConfig() { return config; },
    async saveConfig(next) { Object.assign(config, next); },
    async listTasks() { return [meta]; },
    async getTask(_owner, id) { return id === meta.bookId ? { meta } : null; },
    async readVersionText(_owner, id, version) { return id === meta.bookId && version === 'ai1' ? '测试正文内容' : ''; },
    async updateTaskMeta(_owner, _id, patch) { Object.assign(meta, patch); },
    async appendSiteSubmitLog(_owner, _id, entry) { logs.push(entry); }
  };
  const browserClient = {
    configured: true,
    async test() { return { ok: true, status: 'ready', sessionKey: 'session-1' }; },
    async action(request) {
      if (request.action === 'upload') {
        return { body: JSON.stringify({ success: true, result: { success: { count: 1, files: [{}] }, failed: { count: 0, files: [] } } }) };
      }
      if (request.action === 'book_list') {
        return { body: JSON.stringify({ success: true, data: [] }) };
      }
      throw new Error(`unexpected action ${request.action}`);
    }
  };
  const sessionStore = {
    getBrowserSession() { return { targetUsername: 'target-user', sessionKey: 'session-1', status: 'ready' }; },
    setBrowserSession() {}
  };
  const credentialStore = { get() { return null; }, set() {} };
  const service = create121WebSubmitService({
    accountResolver: owner => ({ username: owner }),
    createStore: () => store,
    browserClient,
    sessionStore,
    credentialStore,
    now: () => '2026-09-02T00:00:00.000Z'
  });

  const result = await service.submit('alice', { mode: 'selected', ids: [meta.bookId], versions: ['ai1'] });

  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, { submitted: 1, accepted_pending: 0, failed: 0 });
  assert.equal(result.success_groups, 1);
  assert.equal(result.accepted_groups, 0);
  assert.equal(result.failed_groups, 0);
  assert.equal(Array.isArray(result.groups), true);
  assert.equal(Array.isArray(result.tasks), true);
  assert.equal(logs.length, 1);
  assert.equal(typeof service.ensureSession, 'function');
});
