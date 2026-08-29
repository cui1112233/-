const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolveVideoManagementAccountStatus,
  startVideoManagementAccountRelogin
} = require('../lib/batch-factory/video-management-account');

test('video management account status is online only after adapter confirmation', async () => {
  const result = await resolveVideoManagementAccountStatus({
    username: 'tester',
    accountAdapter: {
      getStatus: async username => ({ online: username === 'tester', accountName: '小明' })
    }
  });

  assert.deepEqual(result, { state: 'online', accountName: '小明' });
});

test('missing video management account adapter never fabricates online state', async () => {
  const result = await resolveVideoManagementAccountStatus({ username: 'tester' });
  assert.deepEqual(result, {
    state: 'unavailable',
    accountName: '',
    message: '视频管理系统账号验证能力暂不可用'
  });
});

test('expired adapter session maps to login_required without exposing credentials', async () => {
  const result = await resolveVideoManagementAccountStatus({
    username: 'tester',
    accountAdapter: {
      getStatus: async () => ({ online: false, accountName: '旧账号', reason: 'expired', cookie: 'secret' })
    }
  });

  assert.deepEqual(result, {
    state: 'login_required',
    accountName: '',
    message: '账号登录状态已失效'
  });
  assert.equal(Object.hasOwn(result, 'cookie'), false);
});

test('relogin returns only adapter-confirmed http or https login url', async () => {
  const result = await startVideoManagementAccountRelogin({
    username: 'tester',
    accountAdapter: {
      startRelogin: async () => ({ loginUrl: 'https://video.example.com/login?state=abc', cookie: 'secret' })
    }
  });

  assert.deepEqual(result, {
    state: 'started',
    loginUrl: 'https://video.example.com/login?state=abc'
  });
  assert.equal(Object.hasOwn(result, 'cookie'), false);
});

test('missing or unsafe relogin integration never fabricates a login url', async () => {
  assert.deepEqual(await startVideoManagementAccountRelogin({ username: 'tester' }), {
    state: 'unavailable',
    loginUrl: '',
    message: '视频管理系统重新登录能力暂不可用'
  });

  assert.deepEqual(await startVideoManagementAccountRelogin({
    username: 'tester',
    accountAdapter: {
      startRelogin: async () => ({ loginUrl: 'javascript:alert(1)' })
    }
  }), {
    state: 'unavailable',
    loginUrl: '',
    message: '视频管理系统重新登录能力暂不可用'
  });
});
