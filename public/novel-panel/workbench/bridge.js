(() => {
  const apiPrefix = '/api/';
  const mountedApiPrefix = '/api/novel-panel/';
  const allowedHeaders = new Set(['content-type', 'cache-control', 'pragma', 'x-videoprompttool-session']);
  const nonce = new URLSearchParams(window.location.search).get('nonce');
  const instanceId = new URLSearchParams(window.location.search).get('instance') || 'workspace';
  // The workbench permits a configured AI request to run for up to 400 seconds.
  // Keep the iframe bridge alive slightly longer so it cannot turn a valid
  // long-running model request into a browser-level "Failed to fetch" error.
  const API_BRIDGE_TIMEOUT_MS = 410000;
  const pendingRequests = new Map();
  const nativeFetch = window.fetch.bind(window);
  const nativeSendBeacon = typeof navigator.sendBeacon === 'function'
    ? navigator.sendBeacon.bind(navigator)
    : null;
  const cmUndoEntries = new Map();
  const cmEditableFields = new Map([
    ['novelText', '整段原文'],
    ['characterGuideInput', '人物卡强制名单'],
    ['appearanceReference', '人物外形全局要求'],
    ['globalAnalysisAdvice', '统一风格判断建议'],
    ['mustCoverDetails', '必须拍出的原文细节'],
    ['shotRhythmRequirements', '镜头节奏与推进要求'],
    ['promptExampleText', '画面描述案例'],
    ['promptExampleLogic', '案例通用逻辑'],
    ['genre', '内容类型'],
    ['genreNote', '内容类型修改意见'],
    ['trailerStyle', '统一风格附加视觉信息'],
    ['trailerStyleNote', '统一风格修改意见']
  ]);
  let channelPort = null;
  let handshakeRetryTimer = null;
  let cmContextTimer = null;

  function apiPath(input) {
    try {
      const value = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const currentUrl = new URL(window.location.href);
      const url = new URL(value, currentUrl);
      if (url.origin !== currentUrl.origin || !url.pathname.startsWith(apiPrefix)) return null;
      // TTS is a platform service, not a novel-panel business endpoint.
      // Keep its path intact so the parent can attach the session token.
      if (url.pathname === '/api/tts') return url.pathname + url.search;
      if (!url.pathname.startsWith(mountedApiPrefix)) {
        url.pathname = mountedApiPrefix + url.pathname.slice(apiPrefix.length);
      }
      return url.pathname + url.search;
    } catch (_) {
      return null;
    }
  }

  function allowedRequestHeaders(headers) {
    const result = {};
    for (const [name, value] of new Headers(headers || {})) {
      if (allowedHeaders.has(name.toLowerCase())) result[name] = value;
    }
    return result;
  }

  function nextRequestId(prefix = 'v77') {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function postPendingRequest(pending) {
    channelPort.postMessage({ type: 'novel-panel-api-request', id: pending.id, ...pending.request });
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function createAbortError(reason) {
    if (reason) return reason;
    return new DOMException('The operation was aborted.', 'AbortError');
  }

  function clearPending(pending) {
    clearTimeout(pending.timer);
    if (pending.abortSignal && pending.abortListener) {
      pending.abortSignal.removeEventListener('abort', pending.abortListener);
    }
  }

  function requestParentApi(request, signal, { cancelOnClose = true } = {}) {
    const id = nextRequestId();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(createAbortError(signal.reason));
        return;
      }
      const timer = setTimeout(() => {
        cancelPendingRequest(id, new Error('Novel panel API bridge timed out.'));
      }, API_BRIDGE_TIMEOUT_MS);
      const pending = {
        id,
        request,
        resolve,
        reject,
        timer,
        abortSignal: signal,
        abortListener: null,
        cancelOnClose
      };
      pending.abortListener = () => cancelPendingRequest(id, createAbortError(signal.reason));
      signal?.addEventListener?.('abort', pending.abortListener, { once: true });
      pendingRequests.set(id, pending);
      if (channelPort) postPendingRequest(pending);
    });
  }

  function cancelPendingRequest(id, error) {
    const pending = pendingRequests.get(id);
    if (!pending) return;
    pendingRequests.delete(id);
    clearPending(pending);
    if (channelPort) channelPort.postMessage({ type: 'novel-panel-api-cancel', id });
    pending.reject(error || new Error('Novel panel API bridge closed.'));
  }

  function rejectPendingRequests() {
    for (const [id, pending] of pendingRequests) {
      if (pending.cancelOnClose !== false) cancelPendingRequest(id, new Error('Novel panel API bridge closed.'));
    }
  }

  function beaconPayload(data) {
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      return { body: data, headers: data.type ? { 'Content-Type': data.type } : {} };
    }
    if (typeof data === 'string') {
      const trimmed = data.trim();
      return {
        body: data,
        headers: { 'Content-Type': trimmed.startsWith('{') || trimmed.startsWith('[') ? 'application/json' : 'text/plain;charset=UTF-8' }
      };
    }
    if (data == null) return { body: '', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } };
    return { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } };
  }

  function cmText(value, limit = 1200) {
    return String(value ?? '').trim().slice(0, limit);
  }

  function cmHash(value) {
    const source = String(value || '');
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function cmWorkspaceIdentity() {
    try {
      if (typeof state !== 'undefined' && state?.currentHistoryId) return `history:${String(state.currentHistoryId).slice(0, 120)}`;
    } catch (_) {}
    return `draft:${String(instanceId).slice(0, 120)}`;
  }

  function cmReadStateArray(name) {
    try {
      if (typeof state !== 'undefined' && Array.isArray(state?.[name])) return state[name];
    } catch (_) {}
    return [];
  }

  function cmCurrentSelection() {
    const element = document.activeElement;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return null;
    const fieldId = element.id;
    const fieldLabel = cmEditableFields.get(fieldId);
    if (!fieldLabel || typeof element.selectionStart !== 'number' || typeof element.selectionEnd !== 'number') return null;
    const start = Math.max(0, element.selectionStart);
    const end = Math.max(start, element.selectionEnd);
    if (end <= start) return null;
    const value = String(element.value || '');
    const selectedText = value.slice(start, end);
    const fingerprint = cmHash(`${value.length}:${start}:${end}:${value.slice(Math.max(0, start - 32), Math.min(value.length, end + 32))}`);
    return {
      type: 'novel-editor-selection',
      id: `novel-selection:${fieldId}:${start}:${end}:${fingerprint}`,
      label: `${fieldLabel} · 已选 ${selectedText.length} 字`,
      meta: {
        fieldId,
        fieldLabel,
        start,
        end,
        totalLength: value.length,
        text: selectedText.slice(0, 1600)
      }
    };
  }

  function cmSnapshot() {
    const sourceElement = document.querySelector('#novelText');
    const source = String(sourceElement?.value || '');
    const characters = cmReadStateArray('characters');
    const scenes = cmReadStateArray('scenes');
    const shots = cmReadStateArray('outlineShots');
    const segments = cmReadStateArray('segments');
    let historyId = '';
    let historyNote = '';
    let sourceDirty = false;
    try {
      if (typeof state !== 'undefined') {
        historyId = cmText(state?.currentHistoryId, 120);
        historyNote = cmText(state?.currentHistoryNote, 160);
        sourceDirty = state?.sourceDirty === true;
      }
    } catch (_) {}
    const projectName = cmText(document.querySelector('#projectName')?.value, 160);
    const workspaceId = cmWorkspaceIdentity();
    const workspaceLabel = historyNote || projectName || '当前工作区';
    const selection = cmCurrentSelection();
    const sourceTargetId = `novel-source:${workspaceId}`;
    return {
      ready: document.readyState !== 'loading',
      workspace: {
        id: workspaceId,
        historyId,
        label: workspaceLabel,
        sourceTargetId,
        sourceLength: source.length,
        characterCount: characters.length,
        sceneCount: scenes.length,
        shotCount: shots.length,
        segmentCount: segments.length,
        sourceDirty
      },
      sourceTargetId,
      selection,
      sourcePreview: source.slice(0, 900),
      summary: `当前工作区：${workspaceLabel}；原文 ${source.length} 字；人物卡 ${characters.length}；分镜 ${scenes.length}；镜头 ${shots.length}${sourceDirty ? '；原文已改动，现有分镜需要重新生成' : ''}${selection ? `；当前正在编辑 ${selection.meta.fieldLabel}，选中 ${selection.meta.text.length} 字` : ''}`
    };
  }

  function cmCommitField(fieldId, nextValue, reason) {
    const element = document.getElementById(fieldId);
    if (!element || !cmEditableFields.has(fieldId) || !('value' in element)) throw new Error('当前编辑对象已经不可用，请重新选中后再试。');
    const value = String(nextValue ?? '').slice(0, fieldId === 'novelText' ? 120000 : 20000);
    if (typeof writeFieldValue === 'function') writeFieldValue(`#${fieldId}`, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      if (typeof commitLatestEditableUiState === 'function') commitLatestEditableUiState(reason || 'cm_bridge_apply');
    } catch (_) {}
    try {
      if (typeof scheduleDraftSave === 'function') scheduleDraftSave();
    } catch (_) {}
    return value;
  }

  function cmStoreUndo(fieldId, previousValue, appliedValue, selectionStart = null, selectionEnd = null) {
    const token = `novel-undo:${nextRequestId('cm')}`;
    cmUndoEntries.set(token, { fieldId, previousValue, appliedValue, selectionStart, selectionEnd });
    while (cmUndoEntries.size > 20) cmUndoEntries.delete(cmUndoEntries.keys().next().value);
    return token;
  }

  function cmApplyAction(action) {
    if (!action || typeof action !== 'object') throw new Error('CM 修改格式无效。');
    if (action.type === 'novel.source.update') {
      const expectedTarget = cmSnapshot().sourceTargetId;
      if (!action.targetId || action.targetId !== expectedTarget) throw new Error('当前工作区已经变化，请让 CM 基于最新原文重新提出修改。');
      const element = document.getElementById('novelText');
      if (!element) throw new Error('当前原文编辑器不可用。');
      const nextText = Object.prototype.hasOwnProperty.call(action.patch || {}, 'text') ? action.patch.text : action.patch?.value;
      if (typeof nextText !== 'string') throw new Error('CM 没有提供新的原文内容。');
      const previousValue = String(element.value || '');
      const appliedValue = cmCommitField('novelText', nextText, 'cm_source_update');
      const undoToken = cmStoreUndo('novelText', previousValue, appliedValue);
      return { ok: true, message: '已更新整段原文；如果已有分镜，请按页面提示重新生成。', undoToken };
    }

    if (action.type === 'novel.selection.replace') {
      const selection = cmCurrentSelection();
      if (!selection || !action.targetId || action.targetId !== selection.id) throw new Error('选区已经变化，请重新选中文字后再让 CM 修改。');
      const fieldId = selection.meta.fieldId;
      const element = document.getElementById(fieldId);
      if (!element || !cmEditableFields.has(fieldId)) throw new Error('当前选区不可编辑。');
      const replacement = Object.prototype.hasOwnProperty.call(action.patch || {}, 'text') ? action.patch.text : action.patch?.value;
      if (typeof replacement !== 'string') throw new Error('CM 没有提供替换文本。');
      const previousValue = String(element.value || '');
      const start = selection.meta.start;
      const end = selection.meta.end;
      const nextValue = previousValue.slice(0, start) + replacement + previousValue.slice(end);
      const appliedValue = cmCommitField(fieldId, nextValue, 'cm_selection_replace');
      const nextCaret = Math.min(appliedValue.length, start + replacement.length);
      try {
        element.focus();
        element.setSelectionRange(start, nextCaret);
      } catch (_) {}
      const undoToken = cmStoreUndo(fieldId, previousValue, appliedValue, start, end);
      return { ok: true, message: `已替换「${selection.meta.fieldLabel}」中的选中文字。`, undoToken };
    }

    throw new Error('小说面板暂不支持这个 CM 操作。');
  }

  function cmUndo(token) {
    const entry = cmUndoEntries.get(String(token || ''));
    if (!entry) throw new Error('这次修改已经无法撤销。');
    const element = document.getElementById(entry.fieldId);
    if (!element || String(element.value || '') !== entry.appliedValue) throw new Error('内容在修改后又发生了变化，为避免覆盖新编辑，本次撤销已取消。');
    cmCommitField(entry.fieldId, entry.previousValue, 'cm_bridge_undo');
    if (Number.isInteger(entry.selectionStart) && Number.isInteger(entry.selectionEnd)) {
      try {
        element.focus();
        element.setSelectionRange(entry.selectionStart, entry.selectionEnd);
      } catch (_) {}
    }
    cmUndoEntries.delete(String(token || ''));
    return { ok: true, message: '已撤销 CM 的上一次修改。' };
  }

  function postCmContext(type = 'novel-panel-cm-context', id = '') {
    if (!channelPort) return;
    let context;
    try {
      context = cmSnapshot();
    } catch (_) {
      context = { ready: false, workspace: null, selection: null, summary: '小说工作台正在初始化。' };
    }
    channelPort.postMessage({ type, id, context });
  }

  function scheduleCmContextPush() {
    clearTimeout(cmContextTimer);
    cmContextTimer = setTimeout(() => postCmContext('novel-panel-cm-context-changed'), 180);
  }

  function handleCmPortMessage(message) {
    const data = message?.data;
    if (!data || typeof data.type !== 'string') return false;
    if (data.type === 'novel-panel-cm-context-request') {
      postCmContext('novel-panel-cm-context', typeof data.id === 'string' ? data.id : '');
      return true;
    }
    if (data.type === 'novel-panel-cm-action-request') {
      const id = typeof data.id === 'string' ? data.id : '';
      try {
        const result = cmApplyAction(data.action);
        channelPort?.postMessage({ type: 'novel-panel-cm-action-result', id, ...result });
      } catch (error) {
        channelPort?.postMessage({ type: 'novel-panel-cm-action-result', id, ok: false, message: error?.message || 'CM 修改应用失败。' });
      }
      scheduleCmContextPush();
      return true;
    }
    if (data.type === 'novel-panel-cm-undo-request') {
      const id = typeof data.id === 'string' ? data.id : '';
      try {
        const result = cmUndo(data.undoToken);
        channelPort?.postMessage({ type: 'novel-panel-cm-undo-result', id, ...result });
      } catch (error) {
        channelPort?.postMessage({ type: 'novel-panel-cm-undo-result', id, ok: false, message: error?.message || 'CM 修改撤销失败。' });
      }
      scheduleCmContextPush();
      return true;
    }
    return false;
  }

  function sendHandshake() {
    if (!nonce || channelPort || window.parent === window) return;
    window.parent.postMessage({ type: 'qiantie-v77-handshake', nonce }, '*');
  }

  function stopHandshakeRetries() {
    if (handshakeRetryTimer === null) return;
    clearInterval(handshakeRetryTimer);
    handshakeRetryTimer = null;
  }

  function startHandshakeRetries() {
    if (!nonce || window.parent === window || handshakeRetryTimer !== null) return;
    sendHandshake();
    handshakeRetryTimer = setInterval(sendHandshake, 150);
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== 'qiantie-theme-sync') return;
    if (data.theme !== 'dark' && data.theme !== 'light') return;
    document.documentElement.dataset.theme = data.theme;
  });

  window.addEventListener('message', event => {
    if (event.source !== window.parent || channelPort) return;
    const data = event.data;
    const port = event.ports?.[0];
    if (!data || data.type !== 'qiantie-v77-port' || data.nonce !== nonce || !port) return;
    channelPort = port;
    stopHandshakeRetries();
    channelPort.onmessage = message => {
      if (handleCmPortMessage(message)) return;
      const response = message.data;
      if (!response || response.type !== 'novel-panel-api-response' || typeof response.id !== 'string') return;
      const pending = pendingRequests.get(response.id);
      if (!pending) return;
      pendingRequests.delete(response.id);
      clearPending(pending);
      const status = Number.isInteger(response.status) && response.status >= 200 && response.status <= 599 ? response.status : 500;
      const rawBody = typeof response.bodyBase64 === 'string'
        ? base64ToBytes(response.bodyBase64)
        : (typeof response.text === 'string' ? response.text : '');
      const body = [204, 205, 304].includes(status) ? null : rawBody;
      pending.resolve(new Response(body, { status, headers: response.headers || {} }));
    };
    channelPort.start?.();
    for (const pending of pendingRequests.values()) postPendingRequest(pending);
    setTimeout(() => postCmContext('novel-panel-cm-context-changed'), 0);
  });

  function closeBridge() {
    stopHandshakeRetries();
    clearTimeout(cmContextTimer);
    // CharacterCore listens before this bridge closes so its lease release
    // still travels through the authenticated parent-page channel.
    const eventTarget = typeof globalThis.dispatchEvent === 'function' ? globalThis : window;
    eventTarget.dispatchEvent?.(new Event('qiantie-v77-bridge-closing'));
    rejectPendingRequests();
    channelPort?.close();
    channelPort = null;
  }

  window.addEventListener('pagehide', closeBridge);
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    closeBridge();
    startHandshakeRetries();
  });
  window.addEventListener('beforeunload', closeBridge);
  document.addEventListener('input', scheduleCmContextPush, true);
  document.addEventListener('change', scheduleCmContextPush, true);
  document.addEventListener('selectionchange', scheduleCmContextPush);
  document.addEventListener('click', scheduleCmContextPush, true);
  window.addEventListener('DOMContentLoaded', () => setTimeout(scheduleCmContextPush, 0), { once: true });

  startHandshakeRetries();

  window.fetch = function novelPanelFetch(input, init = {}) {
    const path = apiPath(input);
    if (!path) return nativeFetch(input, init);
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers = allowedRequestHeaders(init.headers || (input instanceof Request ? input.headers : undefined));
    const signal = init.signal || (input instanceof Request ? input.signal : undefined);
    const hasBody = Object.prototype.hasOwnProperty.call(init, 'body');
    if (input instanceof Request && !hasBody && method !== 'GET' && method !== 'HEAD') {
      return input.clone().text().then(body => requestParentApi({ path, method, headers, body }, signal));
    }
    return requestParentApi({ path, method, headers, body: hasBody ? init.body : undefined }, signal);
  };

  navigator.sendBeacon = function novelPanelSendBeacon(endpoint, data) {
    const path = apiPath(endpoint);
    if (!path) return nativeSendBeacon ? nativeSendBeacon(endpoint, data) : false;
    const payload = beaconPayload(data);
    requestParentApi(
      { path, method: 'POST', headers: payload.headers, body: payload.body },
      undefined,
      { cancelOnClose: false }
    ).catch(() => {});
    return true;
  };
})();
