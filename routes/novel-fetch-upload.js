const express = require('express');
const { apiAuth } = require('../middleware/auth');
const target = require('../lib/target-upload');
const { createMySQLWorkshopStore } = require('../lib/novel-fetch-workshop/mysql-store');
const { create121DirectClient } = require('../lib/novel-fetch-workshop/121-direct-client');

function isValidBookId(value) {
  return typeof value === 'string' && /^\d{1,20}$/.test(value);
}

function targetBaseUrl() { return `http://${target.TARGET_HOST}/tttadmin`; }
function isExpiredSessionError(error) {
  return error?.status === 401 || error?.code === 'SESSION_EXPIRED' || error?.code === 'session_expired';
}
function directErrorStatus(error) {
  if (isExpiredSessionError(error)) return 401;
  return Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 400;
}

function safeErrorMessage(error, fallback) {
  const message = String(error?.message || fallback);
  return /password|cookie|session|secret|token|authorization/i.test(message) ? fallback : message;
}

function errorResponse(error, fallback) {
  const response = { ok: false, error: safeErrorMessage(error, fallback) };
  if (error?.code === 'SESSION_EXPIRED') response.code = 'SESSION_EXPIRED';
  return response;
}

function createNovelFetchUploadRouter({ auth = apiAuth, store, workshopGateway = {}, directClient = create121DirectClient() } = {}) {
  const router = express.Router();
  router.use(auth);

  router.post('/upload-login', async (req, res) => {
    try {
      if (!store || typeof store.setSession !== 'function') return res.status(500).json({ ok: false, error: '121 上传会话存储未启用' });
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
        return res.status(400).json({ ok: false, error: '请输入账号和密码' });
      }
      const targetUsername = username.trim();
      const baseUrl = targetBaseUrl();
      const result = await directClient.login({ username: targetUsername, password });
      store.setSession(req.username, String(result?.cookie || ''), { targetUsername, baseUrl });
      return res.json({ ok: true, username: targetUsername, status: 'ready' });
    } catch (error) {
      return res.status(directErrorStatus(error)).json(errorResponse(error, '登录失败'));
    }
  });

  router.get('/upload-session', async (req, res) => {
    try {
      const session = store && typeof store.getSession === 'function' ? store.getSession(req.username) : null;
      if (!session?.cookie) return res.json({ ok: true, loggedIn: false, status: 'missing', lastVerifiedAt: null });
      await directClient.verify({ cookie: session.cookie });
      return res.json({ ok: true, loggedIn: true, status: 'ready', lastVerifiedAt: new Date().toISOString() });
    } catch (error) {
      if (isExpiredSessionError(error)) return res.status(401).json({ ok: false, loggedIn: false, notLoggedIn: true, status: 'expired', lastVerifiedAt: null, error: '目标站登录已失效，请重新登录' });
      return res.status(directErrorStatus(error)).json({ ok: false, loggedIn: false, error: error?.message || '121 会话验证失败', ...(error?.code ? { code: error.code } : {}) });
    }
  });

  router.post('/upload-batch', async (req, res) => {
    try {
      if (!store || typeof store.getSession !== 'function') return res.status(500).json({ ok: false, error: '121 上传会话存储未启用' });
      const session = store.getSession(req.username);
      if (!session?.cookie) {
        return res.json({ ok: false, notLoggedIn: true, error: '请先登录目标站' });
      }
      await directClient.verify({ cookie: session.cookie });
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
        if (item.source === 'workshop') {
          const workshopTasks = createMySQLWorkshopStore({ ...workshopGateway, account: req.auth.account });
          const version = String(item.version || 'edited').trim() || 'edited';
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
          results.push({ bookId, status: 'error', error: safeErrorMessage(error, '上传失败') });
          continue;
        }
        const { boundary, body } = target.buildMultipart(fields, { filename: target.buildTargetUploadFilename(bookId), content });
        try {
          const response = await directClient.action({
            cookie: session.cookie,
            method: 'POST',
            path: target.TARGET_UPLOAD_PATH,
            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
            body
          });
          let data = {};
          try { data = JSON.parse(String(response?.body || '')); } catch (_) {}
          if (data.success === true) results.push({ bookId, status: 'ok', error: null });
          else results.push({ bookId, status: 'error', error: safeErrorMessage({ message: data.message || data.msg }, '上传失败') });
        } catch (error) {
          if (isExpiredSessionError(error)) return res.status(401).json({ ok: false, notLoggedIn: true, error: '目标站登录已失效，请重新登录' });
          if (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599) {
            return res.status(directErrorStatus(error)).json(errorResponse(error, '上传失败'));
          }
          results.push({ bookId, status: 'error', error: safeErrorMessage(error, '上传失败') });
        }
      }
      return res.json({ ok: true, results });
    } catch (error) {
      return res.status(directErrorStatus(error)).json(errorResponse(error, '上传失败'));
    }
  });

  return router;
}

module.exports = { createNovelFetchUploadRouter, isValidBookId, targetBaseUrl, isExpiredSessionError };
