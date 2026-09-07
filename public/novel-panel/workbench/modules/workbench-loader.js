(function () {
  'use strict';
  if (window.__QIANTE_WORKBENCH__) return;
  const implementations = window.__QIANTE_WORKBENCH_FEATURES__ ||= Object.create(null);
  const states = Object.create(null);
  const entries = Object.create(null);
  const notices = Object.create(null);
  const labels = {
    'history-save-export': '历史记录与导出',
    'diagnostics-runtime': '诊断中心',
    'premium-image': '精品图片',
    'settings-instructions': '设置与指令中心'
  };
  const template = document.querySelector('#workbenchFeatureAssets');
  for (const link of template?.content.querySelectorAll('a[data-feature]') || []) {
    const name = link.dataset.feature;
    const entry = entries[name] ||= {};
    entry[link.dataset.legacy ? 'legacy' : 'primary'] = link.getAttribute('href');
  }

  function failure(name) {
    const error = new Error(`${labels[name] || '可选功能'}加载失败，请点击重试。`);
    error.code = 'WORKBENCH_FEATURE_LOAD_FAILED';
    return error;
  }

  function showFailure(name, fallback = '') {
    let notice = notices[name];
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'settings-message error';
      notice.dataset.workbenchFeatureError = name;
      notice.setAttribute('role', 'status');
      const message = document.createElement('span');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn secondary';
      retry.textContent = '重试加载';
      // Retrying a download must never replay a save, export or AI request.
      retry.addEventListener('click', () => retryFeature(name).catch(() => {}));
      notice.append(message, retry);
      document.body.appendChild(notice);
      notices[name] = notice;
    }
    notice.children[0].textContent = failure(name).message + (fallback === 'loaded'
      ? ' 已启用兼容路径，操作结果以功能内提示为准。'
      : fallback === 'failed' ? ' 兼容路径也不可用；本次操作未执行。' : ' 正文输入和分镜功能仍可使用。');
    notice.hidden = false;
  }

  function download(name, legacy) {
    const key = `${legacy ? 'legacy:' : ''}${name}`;
    const url = entries[name]?.[legacy ? 'legacy' : 'primary'];
    return new Promise((resolve, reject) => {
      if (!url) { reject(failure(name)); return; }
      const script = document.createElement('script');
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (ok && implementations[key]) resolve(implementations[key]);
        else { script.remove(); reject(failure(name)); }
      };
      const timer = setTimeout(() => finish(false), 15000);
      script.async = true;
      script.src = url;
      script.onload = () => finish(true);
      script.onerror = () => finish(false);
      document.head.appendChild(script);
    });
  }

  function loadFeature(name) {
    if (!Object.hasOwn(entries, name)) return Promise.reject(failure(name));
    const state = states[name] ||= { status: 'idle' };
    if (state.promise) return state.promise;
    state.status = 'loading';
    state.promise = download(name, false).then(methods => {
      state.status = 'loaded';
      if (notices[name]) notices[name].hidden = true;
      return methods;
    }, error => {
      state.status = 'failed';
      showFailure(name, state.fallback);
      throw error;
    });
    return state.promise;
  }

  function retryFeature(name) {
    const state = states[name];
    if (state?.status === 'failed') {
      state.promise = null;
      // A previous failed compatibility request may be retried by the next action.
      if (state.fallback === 'failed') state.fallbackPromise = null;
    }
    return loadFeature(name);
  }

  function loadLegacy(name) {
    const state = states[name];
    if (!state) return Promise.reject(failure(name));
    if (state.fallbackPromise) return state.fallbackPromise;
    state.fallback = 'loading';
    state.fallbackPromise = download(name, true).then(methods => {
      state.fallback = 'loaded';
      showFailure(name, state.fallback);
      return methods;
    }, error => {
      state.fallback = 'failed';
      showFailure(name, state.fallback);
      throw error;
    });
    return state.fallbackPromise;
  }

  async function invoke(name, method, context, args) {
    let methods;
    try { methods = await loadFeature(name); }
    catch (_) { methods = await loadLegacy(name); }
    if (typeof methods[method] !== 'function') throw failure(name);
    // Business errors are deliberately outside the load/fallback catch.
    return methods[method](typeof context === 'function' ? context() : context, ...args);
  }

  window.__QIANTE_WORKBENCH__ = { loadFeature, retryFeature, invoke, states };
})();
