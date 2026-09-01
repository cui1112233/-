const test = require('node:test');
const assert = require('node:assert/strict');
const { create121WebSubmitService } = require('../lib/novel-fetch-workshop/121-web-submit-service');

function fixture() {
  let config = {
    styles: ['旧风格'],
    web_submit: {
      enabled: true,
      username: 'site-user',
      password_masked: false,
      submit_versions: ['ai1'],
      retry_times: 1,
      upload_profiles: [],
      profile_bindings: {}
    }
  };
  const docs = new Map([
    ['10001', {
      meta: { bookId: '10001', platformId: '2', gender: '女频', style: '现代甜文', aiCount: 1 },
      versions: { ai1: '测试文案正文'.repeat(20) }
    }]
  ]);
  const calls = [];
  const store = {
    async getConfig() { return config; },
    async saveConfig(next) { config = next; return { settings: next }; },
    async listTasks() { return [...docs.values()].map(doc => doc.meta); },
    async getTask(_owner, id) { const doc = docs.get(String(id)); return doc ? { meta: doc.meta, document: doc } : null; },
    async readVersionText(_owner, id, version) { return docs.get(String(id))?.versions?.[version] || ''; },
    async updateTaskMeta(_owner, id, patch) { Object.assign(docs.get(String(id)).meta, patch); return docs.get(String(id)).meta; },
    async appendSiteSubmitLog(_owner, id, entry) { calls.push(['submit-log', String(id), entry]); }
  };
  const sessionStore = {
    browser: null,
    setBrowserSession(_owner, value) { this.browser = value; return value; },
    getBrowserSession() { return this.browser; }
  };
  const credentialStore = {
    value: null,
    set(_owner, value) { this.value = value; },
    get() { return this.value; },
    clear() { this.value = null; }
  };
  const browserClient = {
    configured: true,
    async login(input) { calls.push(['login', input]); return { ok: true, status: 'ready', sessionKey: 'opaque-session' }; },
    async test(input) { calls.push(['test', input]); return { ok: true, status: 'ready', sessionKey: 'opaque-session' }; },
    async refresh(input) { calls.push(['refresh', input]); return { ok: true, status: 'ready', sessionKey: 'opaque-session-2' }; },
    async action(input) {
      calls.push(['action', input]);
      if (input.action === 'config_list') return { ok: true, body: JSON.stringify({ success: true, data: [{ id: 7, config_name: '女频甜文', is_default: 1, config_data: JSON.stringify({ platform_id: 2, gender: 2, style: 302, jieya_num: 4, gunping_num: 4 }) }] }) };
      if (input.action === 'dashboard') return { ok: true, body: '<select id="style"><option value="302">现代甜文</option><option value="303">现代悬疑</option></select>' };
      if (input.action === 'upload') return { ok: true, body: JSON.stringify({ success: true, result: { success: { count: 1, files: ['10001.txt'] }, failed: { count: 0, files: [] } } }) };
      if (input.action === 'book_list') return { ok: true, body: JSON.stringify({ success: true, data: [{ id: 91, bookid: '10001', book_platform: 2, gender: 2, style: 302, jian_data: JSON.stringify({ jieya: { jieya_num: 4 }, gunping: { gunping_num: 4 } }) }] }) };
      throw new Error(`unexpected action ${input.action}`);
    }
  };
  const service = create121WebSubmitService({
    accountResolver: owner => ({ username: owner, isOwner: true }),
    createStore: () => store,
    sessionStore,
    credentialStore,
    browserClient,
    baseUrl: 'http://two.121w.com/tttadmin'
  });
  return { service, store, docs, sessionStore, credentialStore, browserClient, calls, getConfig: () => config };
}

test('saving 121 config authenticates through browser worker and never persists or returns plaintext password', async () => {
  const f = fixture();
  const result = await f.service.saveConfig('alice', { enabled: true, username: 'site-user', password: 'secret-pw', submit_versions: ['ai1'] });
  assert.equal(f.calls[0][0], 'login');
  assert.equal(f.calls[0][1].password, 'secret-pw');
  assert.equal(f.sessionStore.browser.sessionKey, 'opaque-session');
  assert.equal(f.credentialStore.value.password, 'secret-pw');
  assert.equal(Object.hasOwn(f.getConfig().web_submit, 'password'), false);
  assert.equal(Object.hasOwn(result.settings, 'password'), false);
  assert.equal(result.settings.password_masked, true);
  assert.equal(Array.isArray(result.tasks), true);
});

test('changing the 121 username requires a fresh password and cannot reuse the previous session silently', async () => {
  const f = fixture();
  f.sessionStore.browser = { mode: 'browser_worker', sessionKey: 'old', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready' };
  await assert.rejects(() => f.service.saveConfig('alice', { enabled: true, username: 'different-user' }), /重新输入密码|重新登录/);
  assert.equal(f.getConfig().web_submit.username, 'site-user');
});

test('expired 121 session refreshes from owner-scoped credentials before authenticated actions', async () => {
  const f = fixture();
  f.sessionStore.browser = { mode: 'browser_worker', sessionKey: 'old', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready' };
  f.credentialStore.value = { targetUsername: 'site-user', password: 'secret-pw', baseUrl: 'http://two.121w.com/tttadmin' };
  f.browserClient.test = async input => { f.calls.push(['test', input]); const error = new Error('expired'); error.status = 401; error.code = 'session_expired'; throw error; };
  const result = await f.service.syncStyles('alice');
  assert.equal(f.calls.some(([kind]) => kind === 'refresh'), true);
  assert.deepEqual(result.styles, ['现代甜文', '现代悬疑']);
  assert.deepEqual(f.getConfig().styles, ['现代甜文', '现代悬疑']);
});

test('syncing 121 profiles uses browser worker config_list action and persists imported profiles', async () => {
  const f = fixture();
  f.sessionStore.browser = { mode: 'browser_worker', sessionKey: 'opaque-session', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready' };
  const result = await f.service.syncConfigs('alice');
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].config_id, '7');
  assert.equal(result.groups[0].gender, '女');
  assert.equal(f.calls.some(([, input]) => input?.action === 'config_list'), true);
});

test('visible 121 test requests headed browser capability instead of a Node HTTP dashboard check', async () => {
  const f = fixture();
  f.sessionStore.browser = { mode: 'browser_worker', sessionKey: 'opaque-session', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready' };
  const result = await f.service.testVisible('alice');
  const testCall = f.calls.find(([kind]) => kind === 'test');
  assert.equal(testCall[1].headed, true);
  assert.equal(result.ok, true);
});

test('preview and submit keep version/profile semantics but upload and verify only through browser worker actions', async () => {
  const f = fixture();
  f.sessionStore.browser = { mode: 'browser_worker', sessionKey: 'opaque-session', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready' };
  await f.service.syncConfigs('alice');
  const preview = await f.service.preview('alice', { mode: 'selected', ids: ['10001'], versions: ['ai1'] });
  assert.equal(preview.groups.length, 1);
  assert.equal(preview.groups[0].items[0].id, '10001');
  const result = await f.service.submit('alice', { mode: 'selected', ids: ['10001'], versions: ['ai1'] });
  assert.equal(result.success_groups, 1);
  assert.equal(result.groups[0].items[0].remote_receipt.remote_record.status, '完成');
  const actions = f.calls.filter(([kind]) => kind === 'action').map(([, input]) => input.action);
  assert.equal(actions.includes('upload'), true);
  assert.equal(actions.includes('book_list'), true);
  assert.equal(f.calls.some(([kind]) => kind === 'submit-log'), true);
});

test('an upload response without a verifiable receipt stays accepted_pending instead of being called submitted', async () => {
  const f = fixture();
  f.sessionStore.browser = { mode: 'browser_worker', sessionKey: 'opaque-session', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready' };
  await f.service.syncConfigs('alice');
  const original = f.browserClient.action.bind(f.browserClient);
  f.browserClient.action = async input => input.action === 'upload'
    ? { ok: true, body: JSON.stringify({ success: true }) }
    : original(input);
  const result = await f.service.submit('alice', { mode: 'selected', ids: ['10001'], versions: ['ai1'] });
  assert.equal(result.success_groups, 0);
  assert.equal(result.accepted_groups, 1);
  assert.equal(f.docs.get('10001').meta.siteSubmitStatus, 'accepted_pending');
});

test('remote record verification reports parameter mismatch rather than claiming a complete match', async () => {
  const f = fixture();
  f.sessionStore.browser = { mode: 'browser_worker', sessionKey: 'opaque-session', targetUsername: 'site-user', baseUrl: 'http://two.121w.com/tttadmin', status: 'ready' };
  await f.service.syncConfigs('alice');
  const original = f.browserClient.action.bind(f.browserClient);
  f.browserClient.action = async input => input.action === 'book_list'
    ? { ok: true, body: JSON.stringify({ success: true, data: [{ id: 91, bookid: '10001', book_platform: 7, gender: 1, style: 303, jian_data: JSON.stringify({ jieya: { jieya_num: 1 }, gunping: { gunping_num: 7 } }) }] }) }
    : original(input);
  const result = await f.service.submit('alice', { mode: 'selected', ids: ['10001'], versions: ['ai1'] });
  const remote = result.groups[0].items[0].remote_receipt.remote_record;
  assert.equal(remote.status, '待确认');
  assert.equal(remote.found, true);
  assert.ok(remote.mismatches.length >= 1);
});
