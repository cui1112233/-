(() => {
  'use strict';

  const CONFIG_PATH = '/api/config';
  const REQUEST_TIMEOUT_MS = 35_000;
  const REQUEST_TIMEOUT_SECONDS = Math.ceil(REQUEST_TIMEOUT_MS / 1000);
  const GUARDED_REQUEST = /^\/api\/(?:config|web-submit(?:\/|$))/;
  const originalApi = api;
  const originalSaveWebSubmitConfig = saveWebSubmitConfig;
  const originalOpenWebLoginDialog = openWebLoginDialog;

  function configFailureMessage(error) {
    const raw = String(error?.message || error || '未知错误').trim();
    if (/401|unauthori[sz]ed|未登录|登录.*失效/i.test(raw)) {
      return '小说获取配置加载失败：主站登录已失效，请重新登录后刷新页面。';
    }
    if (/404|not found/i.test(raw)) {
      return '小说获取配置加载失败：当前运行版本缺少 /api/batch-rewrite/config。';
    }
    return `小说获取配置加载失败：${raw || '未知错误'}`;
  }

  function showConfigFailure(error) {
    const text = configFailureMessage(error);
    state.config = null;
    state.configLoadError = text;
    state.webLoginSession = false;

    const loginBox = document.getElementById('webLoginStatus');
    if (loginBox) {
      loginBox.className = 'web-login-status error';
      loginBox.title = `${text} 已阻止发送 121 账号密码。`;
      loginBox.innerHTML = '<span class="web-login-dot" aria-hidden="true"></span><span>配置加载失败</span>';
    }
    if (typeof setSiteSubmitStatus === 'function') {
      setSiteSubmitStatus(`${text} 已阻止发送 121 账号密码。`);
    }
    const processResult = document.getElementById('processResult');
    if (processResult && !String(processResult.textContent || '').trim()) {
      processResult.textContent = `${text}\n请先恢复主站登录和配置接口，再进行 121 登录验证。`;
    }
    return text;
  }

  api = async function guardedBatchRewriteApi(path, options = {}) {
    if (!GUARDED_REQUEST.test(String(path || ''))) {
      return originalApi(path, options);
    }

    const controller = new AbortController();
    const inheritedSignal = options.signal;
    let inheritedAbortHandler = null;
    if (inheritedSignal) {
      if (inheritedSignal.aborted) controller.abort();
      else {
        inheritedAbortHandler = () => controller.abort();
        inheritedSignal.addEventListener('abort', inheritedAbortHandler, { once: true });
      }
    }
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await originalApi(path, { ...options, signal: controller.signal });
    } catch (error) {
      const timedOut = controller.signal.aborted && !inheritedSignal?.aborted;
      if (timedOut) {
        const target = String(path || '').includes('/web-submit/') ? '121 登录/验证请求' : '小说获取配置请求';
        throw new Error(`请求超时（${REQUEST_TIMEOUT_SECONDS} 秒）：${target}未返回，请检查主站登录和服务状态后重试。`);
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
      if (inheritedSignal && inheritedAbortHandler) {
        inheritedSignal.removeEventListener('abort', inheritedAbortHandler);
      }
    }
  };

  async function ensureServerConfig() {
    if (state.config && !state.configLoadError) return true;
    try {
      const loaded = await api(CONFIG_PATH);
      if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
        throw new Error('配置接口返回了无效数据');
      }
      state.config = loaded;
      state.configLoadError = '';
      renderConfig();
      return true;
    } catch (error) {
      showConfigFailure(error);
      return false;
    }
  }

  saveWebSubmitConfig = async function guardedSaveWebSubmitConfig(silent = false) {
    if (!(await ensureServerConfig())) {
      const error = new Error(state.configLoadError || '小说获取配置加载失败');
      if (!silent && typeof setSiteSubmitStatus === 'function') setSiteSubmitStatus(error.message);
      throw error;
    }
    return originalSaveWebSubmitConfig(silent);
  };

  function bindSafeLoginSubmit(dialog) {
    if (!dialog || dialog.dataset.qiantieSafeLoginBound === '1') return;
    dialog.dataset.qiantieSafeLoginBound = '1';

    dialog.addEventListener('submit', async event => {
      if (event.submitter?.id !== 'webLoginSubmit') return;
      event.preventDefault();
      event.stopImmediatePropagation();

      const result = document.getElementById('webLoginResult');
      const submit = document.getElementById('webLoginSubmit');
      if (submit) submit.disabled = true;

      try {
        if (!(await ensureServerConfig())) {
          if (result) result.textContent = `${state.configLoadError || '小说获取配置加载失败'} 未发送 121 账号密码。`;
          return;
        }

        const username = String(document.getElementById('webLoginUsername')?.value || '').trim();
        const password = String(document.getElementById('webLoginPassword')?.value || '');
        if (!username || !password) throw new Error('请输入 121 账号和密码');

        const currentWebSubmit = state.config?.web_submit || {};
        const settings = { ...currentWebSubmit, username, password };
        if (result) result.textContent = '正在保存登录信息...';

        const saved = await api('/api/web-submit/config', {
          method: 'POST',
          body: JSON.stringify({ settings })
        });
        state.config = {
          ...(state.config || {}),
          web_submit: saved?.settings || { ...currentWebSubmit, username, password: '', password_masked: true }
        };

        if (result) result.textContent = '正在验证 121 登录会话...';
        const check = await api('/api/web-submit/test-visible', {
          method: 'POST',
          body: JSON.stringify({ mode: 'all', ids: [], force: true })
        });
        state.webLoginSession = check?.ok === true;
        state.config = {
          ...(state.config || {}),
          web_submit: {
            ...(state.config?.web_submit || {}),
            username,
            password: '',
            password_masked: state.webLoginSession || Boolean(state.config?.web_submit?.password_masked)
          }
        };
        renderWebLoginStatus(state.config?.web_submit || {});

        if (!state.webLoginSession) throw new Error('121 登录会话验证失败');
        if (result) result.textContent = '登录验证成功';
        window.setTimeout(() => dialog.close(), 500);
      } catch (error) {
        state.webLoginSession = false;
        renderWebLoginStatus(state.config?.web_submit || {});
        if (result) result.textContent = error?.message || '登录验证失败';
      } finally {
        const passwordInput = document.getElementById('webLoginPassword');
        if (passwordInput) passwordInput.value = '';
        if (submit) submit.disabled = false;
      }
    }, true);
  }

  openWebLoginDialog = async function safeOpenWebLoginDialog() {
    if (!(await ensureServerConfig())) {
      if (typeof setSiteSubmitStatus === 'function') {
        setSiteSubmitStatus(`${state.configLoadError || '小说获取配置加载失败'} 已阻止发送 121 账号密码。`);
      }
      return;
    }

    let dialog = document.getElementById('webLoginDialog');
    if (!dialog) {
      await originalOpenWebLoginDialog();
      dialog = document.getElementById('webLoginDialog');
      bindSafeLoginSubmit(dialog);
      return;
    }

    bindSafeLoginSubmit(dialog);
    const usernameInput = document.getElementById('webLoginUsername');
    const passwordInput = document.getElementById('webLoginPassword');
    if (usernameInput) usernameInput.value = state.config?.web_submit?.username || '';
    if (passwordInput) passwordInput.value = '';
    if (!dialog.open) dialog.showModal();
  };

  const staticLoginDialog = document.getElementById('webLoginDialog');
  if (staticLoginDialog) bindSafeLoginSubmit(staticLoginDialog);

  void (async () => {
    if (state.config) {
      state.configLoadError = '';
      return;
    }

    const restored = await ensureServerConfig();
    if (!restored) return;

    try {
      const environment = await api('/api/web-submit/environment');
      state.webLoginSession = environment?.ok === true;
      renderWebLoginStatus(state.config?.web_submit || {});
    } catch (error) {
      state.webLoginSession = false;
      renderWebLoginStatus(state.config?.web_submit || {});
      if (typeof setSiteSubmitStatus === 'function') setSiteSubmitStatus(error?.message || '121 登录状态读取失败');
    }

    await loadTasks().catch(error => {
      const processResult = document.getElementById('processResult');
      if (processResult) processResult.textContent = `任务加载失败：${error?.message || '未知错误'}`;
    });
    if (typeof restoreLatestProcessJob === 'function') {
      await restoreLatestProcessJob().catch(() => {});
    }
  })();
})();
