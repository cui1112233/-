const express = require('express');
const { apiAuth } = require('../middleware/auth');
const target = require('../lib/target-upload');
const { createMySQLWorkshopStore } = require('../lib/novel-fetch-workshop/mysql-store');

function isValidBookId(value) {
  return typeof value === 'string' && /^\d{1,20}$/.test(value);
}

function createNovelFetchUploadRouter({ auth = apiAuth, store, workshopGateway = {}, httpClient = target.requestHttp } = {}) {
  const router = express.Router();
  router.use(auth);

  router.post('/upload-login', async (req, res) => {
    try {
      if (!store) return res.status(500).json({ ok: false, error: '上传存储未启用' });
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
        return res.status(400).json({ ok: false, error: '请输入账号和密码' });
      }
      const login = await httpClient(target.buildLoginRequest(username.trim(), password));
      let data = {};
      try { data = JSON.parse(login.body); } catch (_) {}
      if (data.success !== true) {
        return res.status(400).json({ ok: false, error: data.message || '登录失败，请检查账号密码' });
      }
      const setCookies = login.headers && login.headers['set-cookie'];
      const cookie = Array.isArray(setCookies) ? setCookies.map(c => c.split(';')[0]).join('; ') : '';
      if (!cookie) return res.status(400).json({ ok: false, error: '登录失败，未获取到会话' });
      const check = await httpClient({
        method: 'GET',
        url: `http://${target.TARGET_HOST}${target.TARGET_CHECK_PATH}`,
        headers: { Cookie: cookie }
      });
      if (!target.isDashboard(check.body)) return res.status(400).json({ ok: false, error: '登录验证失败，请重试' });
      store.setSession(req.username, cookie);
      return res.json({ ok: true, username });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || '登录失败' });
    }
  });

  router.get('/upload-session', (req, res) => {
    const session = store ? store.getSession(req.username) : null;
    return res.json({ ok: true, loggedIn: Boolean(session), lastVerifiedAt: session ? session.loginAt : null });
  });

  router.post('/upload-batch', async (req, res) => {
    try {
      if (!store) return res.status(500).json({ ok: false, error: '上传存储未启用' });
      const session = store.getSession(req.username);
      if (!session || !session.cookie) {
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
          results.push({ bookId, status: 'error', error: error.message });
          continue;
        }
        const { boundary, body } = target.buildMultipart(fields, { filename: target.buildTargetUploadFilename(bookId), content });
        try {
          const resp = await httpClient({
            method: 'POST',
            url: `http://${target.TARGET_HOST}${target.TARGET_UPLOAD_PATH}`,
            headers: {
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              Cookie: session.cookie
            },
            body
          });
          if (target.isLoginPage(resp.body)) {
            return res.json({ ok: false, notLoggedIn: true, error: '目标站登录已失效，请重新登录' });
          }
          let data = {};
          try { data = JSON.parse(resp.body); } catch (_) {}
          if (data.success === true) results.push({ bookId, status: 'ok', error: null });
          else results.push({ bookId, status: 'error', error: data.message || data.msg || '上传失败' });
        } catch (error) {
          results.push({ bookId, status: 'error', error: error.message || '上传失败' });
        }
      }
      return res.json({ ok: true, results });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || '上传失败' });
    }
  });

  return router;
}

module.exports = { createNovelFetchUploadRouter, isValidBookId };
