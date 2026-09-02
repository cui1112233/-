const express = require('express');
const { apiAuth } = require('../middleware/auth');
const target = require('../lib/target-upload');
const { createMySQLWorkshopStore } = require('../lib/novel-fetch-workshop/mysql-store');
const { createNovelFetchLifecycleClient } = require('../lib/novel-fetch-workshop/lifecycle-client');
const { create121BrowserClient } = require('../lib/novel-fetch-workshop/121-browser-client');

function isValidBookId(value) {
  return typeof value === 'string' && /^\d{1,20}$/.test(value);
}

function targetBaseUrl() { return `http://${target.TARGET_HOST}/tttadmin`; }
function isExpiredSessionError(error) {
  return error?.status === 401 || error?.code === 'session_expired' || error?.workerResponse?.status === 'expired';
}
function browserErrorStatus(error) {
  if (isExpiredSessionError(error)) return 401;
  if (['BROWSER_WORKER_UNAVAILABLE', 'BROWSER_WORKER_TIMEOUT'].includes(error?.code)) return 503;
  return Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 400;
}

function createNovelFetchUploadRouter({ auth = apiAuth, store, workshopGateway = {}, browserClient = create121BrowserClient() } = {}) {
  const router = express.Router();
  router.use(auth);

  router.post('/upload-login', async (req, res) => {
    try {
      if (!store || typeof store.setBrowserSession !== 'function') return res.status(500).json({ ok: false, error: '浏览器上传会话存储未启用' });
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
        return res.status(400).json({ ok: false, error: '请输入账号和密码' });
      }
      const targetUsername = username.trim();
      const baseUrl = targetBaseUrl();
      const result = await browserClient.login({ owner: req.username, baseUrl, username: targetUsername, password, headed: false });
      store.setBrowserSession(req.username, {
        sessionKey: String(result?.sessionKey || ''),
        targetUsername,
        baseUrl,
        status: String(result?.status || 'ready')
      });
      return res.json({ ok: true, username: targetUsername, status: String(result?.status || 'ready') });
    } catch (error) {
      return res.status(browserErrorStatus(error)).json({ ok: false, error: error?.message || '登录失败', ...(error?.code ? { code: error.code } : {}) });
    }
  });

  router.get('/upload-session', async (req, res) => {
    try {
      const session = store && typeof store.getBrowserSession === 'function' ? store.getBrowserSession(req.username) : null;
      if (!session?.targetUsername || !session?.baseUrl) return res.json({ ok: true, loggedIn: false, status: 'missing', lastVerifiedAt: null });
      const result = await browserClient.test({ owner: req.username, baseUrl: session.baseUrl, username: session.targetUsername, headed: false });
      if (typeof store.setBrowserSession === 'function') {
        store.setBrowserSession(req.username, {
          sessionKey: String(result?.sessionKey || session.sessionKey || ''),
          targetUsername: session.targetUsername,
          baseUrl: session.baseUrl,
          status: String(result?.status || 'ready')
        });
      }
      return res.json({ ok: true, loggedIn: result?.ok === true, status: String(result?.status || 'ready'), lastVerifiedAt: new Date().toISOString() });
    } catch (error) {
      if (isExpiredSessionError(error)) return res.json({ ok: true, loggedIn: false, status: 'expired', lastVerifiedAt: null });
      return res.status(browserErrorStatus(error)).json({ ok: false, loggedIn: false, error: error?.message || '浏览器会话验证失败', ...(error?.code ? { code: error.code } : {}) });
    }
  });

  router.post('/upload-batch', async (req, res) => {
    try {
      if (!store || typeof store.getBrowserSession !== 'function') return res.status(500).json({ ok: false, error: '浏览器上传会话存储未启用' });
      const session = store.getBrowserSession(req.username);
      if (!session?.targetUsername || !session?.baseUrl) {
        return res.json({ ok: false, notLoggedIn: true, error: '请先登录目标站' });
      }
      const { platformId, advanced, items } = req.body || {};
      if (!target.VALID_PLATFORM_IDS.has(Number(platformId))) {
        return res.status(400).json({ ok: false, error: '无效的平台' });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ ok: false, error: '请选择要上传的书籍' });
      }
      if (items.length > 50) return res.status(400).json({ ok: false, error: '一次最多上传 50 本' });
      const normAdvanced = target.normalizeAdvanced(advanced);

      const results = [];
      for (const item of items) {
        const bookId = String(item && item.bookId || '').trim();
        if (!isValidBookId(bookId)) {
          results.push({ bookId, status: 'error', error: '书籍 ID 格式不正确' });
          continue;
        }
        let content = '';
        let meta = {};
        let workshopLifecycle = null;
        let workshopStorageVersion = '';
        if (item.source === 'workshop') {
          const workshopTasks = createMySQLWorkshopStore({ ...workshopGateway, account: req.auth.account });
          const version = String(item.version || 'edited').trim() || 'edited';
          workshopStorageVersion = version === 'edited' ? 'original' : version;
          workshopLifecycle = createNovelFetchLifecycleClient({ ...workshopGateway, account: req.auth.account });
          content = await workshopTasks.readVersionText(req.username, bookId, version);
          if (!content) { results.push({ bookId, status: 'error', error: '未找到该版本的正文' }); continue; }
          const task = await workshopTasks.getTask(req.username, bookId);
          meta = (task && task.meta) || {};
        } else {
          const saved = store.read(req.username, bookId);
          if (!saved || !saved.text) {
            results.push({ bookId, status: 'error', error: '未找到已保存的正文' });
            continue;
          }
          content = saved.text;
          meta = saved.meta || {};
        }
        const gender = String(item.gender || meta.gender || '').trim();
        const style = String(item.style || meta.style || '').trim();
        if (target.GENDER_ID[gender] === undefined || target.STYLE_ID[style] === undefined) {
          results.push({ bookId, status: 'error', error: '请为该本选择性别和风格' });
          continue;
        }
        let fields;
        try {
          fields = target.buildUploadFields({
            platformId,
            gender,
            style,
            advanced: {
              ...normAdvanced,
              jieyaNum: Number.isInteger(item.overrideJieyaNum) ? item.overrideJieyaNum : normAdvanced.jieyaNum,
              gunpingNum: Number.isInteger(item.overrideGunpingNum) ? item.overrideGunpingNum : normAdvanced.gunpingNum
            }
          });
        } catch (error) {
          results.push({ bookId, status: 'error', error: error.message });
          continue;
        }
        const { boundary, body } = target.buildMultipart(fields, { filename: target.buildTargetUploadFilename(bookId), content });
        try {
          const response = await browserClient.action({
            owner: req.username,
            baseUrl: session.baseUrl,
            username: session.targetUsername,
            action: 'upload',
            payload: {
              contentType: `multipart/form-data; boundary=${boundary}`,
              bodyBase64: body.toString('base64')
            }
          });
          let data = {};
          try { data = JSON.parse(String(response?.body || '')); } catch (_) {}
          if (data.success === true) {
            let cleanupDeferred = false;
            if (workshopLifecycle && workshopStorageVersion) {
              try {
                await workshopLifecycle.markBodyReleasable(bookId, workshopStorageVersion, 7);
              } catch (_) {
                cleanupDeferred = true;
              }
            }
            results.push({ bookId, status: 'ok', error: null, ...(cleanupDeferred ? { cleanupDeferred: true } : {}) });
          } else {
            results.push({ bookId, status: 'error', error: data.message || data.msg || '上传失败' });
          }
        } catch (error) {
          if (isExpiredSessionError(error)) return res.json({ ok: false, notLoggedIn: true, error: '目标站登录已失效，请重新登录' });
          results.push({ bookId, status: 'error', error: error?.message || '上传失败' });
        }
      }
      return res.json({ ok: true, results });
    } catch (error) {
      return res.status(browserErrorStatus(error)).json({ ok: false, error: error?.message || '上传失败', ...(error?.code ? { code: error.code } : {}) });
    }
  });

  return router;
}

module.exports = { createNovelFetchUploadRouter, isValidBookId, targetBaseUrl, isExpiredSessionError };
