const assert = require('node:assert/strict');
const test = require('node:test');
const target = require('../target-upload');
const { create121WebSubmitService } = require('./121-web-submit-service');

function makeService() {
  const persisted = [];
  const config = {
    web_submit: {
      enabled: true,
      username: 'shared-121-account',
      selected_profile: '小说获取默认配置',
      skip_submitted: false,
      upload_profiles: [{ id: 'local', name: '小说获取本地配置', source: 'local' }]
    },
    styles: ['原风格']
  };
  const directSession = { cookie: 'PHPSESSID=ready' };
  const calls = [];
  const directClient = {
    async verify({ cookie }) {
      calls.push({ type: 'verify', cookie });
      return { ok: true, cookie };
    },
    async login({ username, password }) {
      calls.push({ type: 'login', username, password });
      return { ok: true, cookie: 'PHPSESSID=renewed' };
    },
    async action(request) {
      calls.push({ type: 'action', ...request });
      if (request.path === target.TARGET_CONFIG_LIST_PATH) {
        return { body: JSON.stringify({ success: true, data: [{ id: '101', config_name: '121 女频档', config_data: JSON.stringify({ gender: '2', platform_id: '121' }) }] }) };
      }
      if (request.path === target.TARGET_CHECK_PATH) {
        return { body: '<select id="style"><option value="8">古风</option></select>' };
      }
      throw new Error(`unexpected direct path ${request.path}`);
    }
  };
  const service = create121WebSubmitService({
    accountResolver: async username => ({ username }),
    createStore: () => ({
      getConfig: async () => config,
      saveConfig: async next => { persisted.push(next); },
      listTasks: async () => []
    }),
    directClient,
    sessionStore: { getSession: () => directSession, setSession: (_, cookie) => { directSession.cookie = cookie; } },
    credentialStore: { get: () => ({ targetUsername: 'shared-121-account', password: 'unused' }), set: () => {} },
    baseUrl: 'http://two.121w.com/tttadmin'
  });
  return { service, persisted, config, calls, directSession };
}

test('Batch Factory read-only 121 synchronizations do not persist into novel-fetch settings', async () => {
  const { service, persisted, config, calls } = makeService();
  const profiles = await service.syncConfigs('owner', { persist: false });
  const styles = await service.syncStyles('owner', { persist: false });

  assert.equal(profiles.groups[0].name, '121 女频档');
  assert.deepEqual(styles.styles, ['古风']);
  assert.equal(persisted.length, 0);
  assert.equal(config.web_submit.selected_profile, '小说获取默认配置');
  assert.deepEqual(config.styles, ['原风格']);
  assert.equal(calls.some(call => call.type === 'action' && call.path === target.TARGET_CONFIG_LIST_PATH), true);
  assert.equal(calls.some(call => call.type === 'action' && call.path === target.TARGET_CHECK_PATH), true);
});

test('shared direct login saves preserve unrelated novel-fetch web-submit settings', async () => {
  const { service, persisted, calls, directSession } = makeService();
  await service.saveConfig('owner', { username: 'shared-121-account', password: 'new-secret' });

  assert.equal(calls.some(call => call.type === 'login' && call.username === 'shared-121-account'), true);
  assert.equal(directSession.cookie, 'PHPSESSID=renewed');
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].web_submit.enabled, true);
  assert.equal(persisted[0].web_submit.skip_submitted, false);
  assert.equal(persisted[0].web_submit.selected_profile, '小说获取默认配置');
});

test('小说获取从共享 121 会话恢复账号并显示为已登录', async () => {
  const config = { web_submit: {} };
  const sharedSession = {
    // 历史共享会话只有 Cookie；这正是公网当前的遗留形态。
    cookie: 'PHPSESSID=shared-ready'
  };
  const service = create121WebSubmitService({
    accountResolver: async username => ({ username }),
    createStore: () => ({
      getConfig: async () => config,
      saveConfig: async () => {},
      listTasks: async () => []
    }),
    directClient: {
      async verify({ cookie }) {
        assert.equal(cookie, 'PHPSESSID=shared-ready');
        return { ok: true };
      },
      async login() { throw new Error('已有可用共享会话时不应重新登录'); },
      async action() { throw new Error('本测试不执行远端动作'); }
    },
    sessionStore: {
      getSession: () => sharedSession,
      setSession: () => {}
    },
    credentialStore: { get: () => ({ targetUsername: 'shared-121-account', password: 'unused' }), set: () => {} },
    baseUrl: 'http://two.121w.com/tttadmin'
  });

  const [settings, environment] = await Promise.all([
    service.getConfig('owner'),
    service.environment('owner')
  ]);

  assert.equal(settings.settings.username, 'shared-121-account');
  assert.equal(environment.ok, true);
  assert.equal(environment.checks[0].name, '121 后台登录会话');
  assert.match(environment.checks[0].detail, /已登录/);
});
