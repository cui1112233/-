import { Alert, Spin } from 'antd';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getToken } from '../../shared/api/client';
import { dispatchPetContext } from '../../shared/pet/stacky';
import { dispatchCmSelection, refreshCmBridgeContext, registerCmBridge } from '../../shared/pet/cmBridge';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const ALLOWED_HEADERS = new Set(['content-type', 'cache-control', 'pragma', 'x-videoprompttool-session']);
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const MAX_REQUEST_ID_LENGTH = 120;
const MAX_HEADER_VALUE_LENGTH = 512;
const MAX_ACTIVE_CONTROLLERS = 8;
const MAX_RESPONSE_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_HEADER_BYTES = 8 * 1024;
const CM_COMMAND_TIMEOUT_MS = 8000;

function normalizeTheme(theme) {
  return theme === 'light' ? 'light' : 'dark';
}

function syncTheme(frame, theme) {
  frame?.contentWindow?.postMessage(
    { type: 'qiantie-theme-sync', theme: normalizeTheme(theme) },
    '*'
  );
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).length;
}

function normalizeBridgeRequest(data) {
  if (!data || data.type !== 'novel-panel-api-request' || typeof data.id !== 'string' || typeof data.path !== 'string') return { error: 400, id: typeof data?.id === 'string' ? data.id.slice(0, MAX_REQUEST_ID_LENGTH) : '' };
  if (!data.id || data.id.length > MAX_REQUEST_ID_LENGTH) return { error: 413, id: data.id.slice(0, MAX_REQUEST_ID_LENGTH) };
  if (data.body !== undefined && typeof data.body !== 'string') return { error: 400, id: data.id };
  if (typeof data.body === 'string' && utf8ByteLength(data.body) > MAX_REQUEST_BODY_BYTES) return { error: 413, id: data.id };
  const method = String(data.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method) || (data.path !== '/api/tts' && !data.path.startsWith('/api/novel-panel/'))) return { error: 400, id: data.id };
  let url;
  try {
    url = new URL(data.path, window.location.origin);
  } catch (_) {
    return { error: 400, id: data.id };
  }
  if (url.origin !== window.location.origin || (url.pathname !== '/api/tts' && !url.pathname.startsWith('/api/novel-panel/'))) return { error: 400, id: data.id };

  const headers = {};
  if (data.headers !== undefined && (!data.headers || typeof data.headers !== 'object' || Array.isArray(data.headers))) return { error: 400, id: data.id };
  for (const [name, value] of Object.entries(data.headers || {})) {
    if (typeof value === 'string' && value.length > MAX_HEADER_VALUE_LENGTH) return { error: 413, id: data.id };
    if (ALLOWED_HEADERS.has(name.toLowerCase()) && typeof value === 'string') headers[name] = value;
  }
  return { id: data.id, path: url.pathname + url.search, method, headers, body: data.body };
}

function postBridgeResponse(target, id, response) {
  target.postMessage({ type: 'novel-panel-api-response', id, ...response });
}

function boundedResponseHeaders(headers) {
  const output = {};
  let size = 0;
  for (const [name, value] of headers.entries()) {
    const entrySize = utf8ByteLength(name) + utf8ByteLength(value);
    if (value.length > MAX_HEADER_VALUE_LENGTH || size + entrySize > MAX_RESPONSE_HEADER_BYTES) continue;
    output[name] = value;
    size += entrySize;
  }
  return output;
}

async function readResponseBytes(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return new Uint8Array(await response.arrayBuffer());
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BODY_BYTES) throw new Error('Novel panel API response exceeds bridge limits');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function createSessionNonce() {
  const values = new Uint8Array(24);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return Array.from(values, value => value.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createInstanceId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return createSessionNonce();
}

function createCmCommandId() {
  return `cm-parent-${createInstanceId()}`.slice(0, MAX_REQUEST_ID_LENGTH);
}

export function NovelPanelPage({ theme }) {
  const frameRef = useRef(null);
  const sessionNonceRef = useRef(createSessionNonce());
  const instanceIdRef = useRef(createInstanceId());
  const handshakeConsumedRef = useRef(false);
  const portRef = useRef(null);
  const controllersRef = useRef(new Map());
  const cmPendingRef = useRef(new Map());
  const cmContextRef = useRef({ ready: false, workspace: null, selection: null, summary: '小说工作台正在加载。' });
  const channelLoadAcknowledgedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const searchParams = new URLSearchParams(window.location.search);
  const projectId = searchParams.get('project');
  const workbenchSrc = `/novel-panel/workbench?nonce=${encodeURIComponent(sessionNonceRef.current)}&instance=${encodeURIComponent(instanceIdRef.current)}${projectId ? `&project=${encodeURIComponent(projectId)}` : ''}`;

  function abortPendingRequests() {
    for (const controller of controllersRef.current.values()) controller.abort();
    controllersRef.current.clear();
  }

  function rejectPendingCmCommands(message = '小说工作台连接已关闭。') {
    for (const pending of cmPendingRef.current.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    cmPendingRef.current.clear();
  }

  function requestWorkbenchCm(type, payload = {}) {
    const port = portRef.current;
    if (!port) return Promise.reject(new Error('小说工作台还没有准备好，请稍后再试。'));
    const id = createCmCommandId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cmPendingRef.current.delete(id);
        reject(new Error('小说工作台响应超时，请重新尝试。'));
      }, CM_COMMAND_TIMEOUT_MS);
      cmPendingRef.current.set(id, { resolve, reject, timer });
      try {
        port.postMessage({ type, id, ...payload });
      } catch (error) {
        clearTimeout(timer);
        cmPendingRef.current.delete(id);
        reject(error);
      }
    });
  }

  function acceptCmContext(context) {
    const next = context && typeof context === 'object'
      ? context
      : { ready: false, workspace: null, selection: null, summary: '小说工作台正在初始化。' };
    cmContextRef.current = next;
    const selection = next.selection && typeof next.selection === 'object' ? next.selection : null;
    dispatchCmSelection(selection);
    const workspace = next.workspace && typeof next.workspace === 'object' ? next.workspace : {};
    dispatchPetContext({
      page: '小说面板',
      pagePath: '/novel-panel',
      summary: String(next.summary || '小说工作台已连接。').slice(0, 1200),
      entities: {
        workspaceId: String(workspace.id || '').slice(0, 160),
        historyId: String(workspace.historyId || '').slice(0, 160),
        sourceLength: Number(workspace.sourceLength || 0),
        characterCount: Number(workspace.characterCount || 0),
        sceneCount: Number(workspace.sceneCount || 0),
        shotCount: Number(workspace.shotCount || 0),
        sourceDirty: workspace.sourceDirty === true
      },
      actions: ['分析当前工作区', '修改当前选中文字', '检查人物卡与分镜']
    });
    refreshCmBridgeContext();
  }

  function handleCmPortMessage(data) {
    if (!data || typeof data.type !== 'string') return false;
    const isContext = data.type === 'novel-panel-cm-context' || data.type === 'novel-panel-cm-context-changed';
    const isResult = data.type === 'novel-panel-cm-action-result' || data.type === 'novel-panel-cm-undo-result';
    if (!isContext && !isResult) return false;
    if (isContext) acceptCmContext(data.context);
    if (typeof data.id === 'string' && data.id) {
      const pending = cmPendingRef.current.get(data.id);
      if (pending) {
        cmPendingRef.current.delete(data.id);
        clearTimeout(pending.timer);
        pending.resolve(data);
      }
    }
    return true;
  }

  useEffect(() => {
    syncTheme(frameRef.current, theme);
  }, [theme]);

  useEffect(() => {
    const stage = error ? '加载失败' : loading ? '加载中' : '可用';
    const opaqueProjectId = String(projectId || '').slice(0, 160);
    if (cmContextRef.current?.ready) return;
    dispatchPetContext({
      page: '小说面板',
      pagePath: '/novel-panel',
      summary: `当前入口项目：${opaqueProjectId || '当前工作区'}；工作台：${stage}`,
      entities: { projectId: opaqueProjectId, stage },
      actions: ['检查当前工作台', '继续编辑工作区']
    });
  }, [projectId, loading, error]);

  useEffect(() => registerCmBridge({
    page: '小说面板',
    pagePath: '/novel-panel',
    capabilities: ['novel.source.update', 'novel.selection.replace'],
    getContext: () => {
      const context = cmContextRef.current || {};
      const workspace = context.workspace && typeof context.workspace === 'object' ? context.workspace : {};
      return {
        page: '小说面板',
        pagePath: '/novel-panel',
        project: {
          id: String(workspace.id || projectId || ''),
          name: String(workspace.label || '当前工作区'),
          historyId: String(workspace.historyId || ''),
          sourceTargetId: String(context.sourceTargetId || workspace.sourceTargetId || ''),
          sourceLength: Number(workspace.sourceLength || 0),
          characterCount: Number(workspace.characterCount || 0),
          sceneCount: Number(workspace.sceneCount || 0),
          shotCount: Number(workspace.shotCount || 0),
          sourceDirty: workspace.sourceDirty === true
        },
        selection: context.selection || null,
        summary: String(context.summary || (error ? '小说工作台加载失败。' : loading ? '小说工作台正在加载。' : '小说工作台已连接。')).slice(0, 1200)
      };
    },
    apply: async action => {
      const response = await requestWorkbenchCm('novel-panel-cm-action-request', { action });
      if (response?.ok !== true) throw new Error(response?.message || '小说工作台没有应用这次修改。');
      return {
        ok: true,
        message: response.message || '小说工作台已应用修改。',
        undoToken: response.undoToken || ''
      };
    },
    undo: async undoToken => {
      const response = await requestWorkbenchCm('novel-panel-cm-undo-request', { undoToken });
      if (response?.ok !== true) throw new Error(response?.message || '小说工作台没有撤销这次修改。');
      return response;
    }
  }), [projectId]);

  useLayoutEffect(() => {
    function closePort() {
      abortPendingRequests();
      rejectPendingCmCommands();
      if (!portRef.current) return;
      portRef.current.onmessage = null;
      portRef.current.close();
      portRef.current = null;
      handshakeConsumedRef.current = false;
      channelLoadAcknowledgedRef.current = false;
      cmContextRef.current = { ready: false, workspace: null, selection: null, summary: '小说工作台连接已关闭。' };
      dispatchCmSelection(null);
      refreshCmBridgeContext();
    }

    async function handlePortRequest(port, event) {
      if (port !== portRef.current) return;
      const data = event.data;
      if (handleCmPortMessage(data)) return;
      if (data?.type === 'novel-panel-api-cancel' && typeof data.id === 'string') {
        const controller = controllersRef.current.get(data.id);
        controller?.abort();
        controllersRef.current.delete(data.id);
        return;
      }
      const request = normalizeBridgeRequest(data);
      if (request?.error) {
        postBridgeResponse(port, request.id, {
          status: request.error,
          headers: { 'content-type': 'application/json' },
          text: JSON.stringify({ error: request.error === 413 ? 'Novel panel request exceeds bridge limits' : 'Invalid novel panel API request' })
        });
        return;
      }
      if (!request) return;
      if (controllersRef.current.size >= MAX_ACTIVE_CONTROLLERS) {
        postBridgeResponse(port, request.id, {
          status: 429,
          headers: { 'content-type': 'application/json' },
          text: JSON.stringify({ error: 'Novel panel bridge is busy' })
        });
        return;
      }
      if (controllersRef.current.has(request.id)) {
        postBridgeResponse(port, request.id, {
          status: 409,
          headers: { 'content-type': 'application/json' },
          text: JSON.stringify({ error: 'Novel panel request id is already active' })
        });
        return;
      }

      const headers = new Headers(request.headers);
      headers.delete('Authorization');
      const token = getToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const controller = new AbortController();
      controllersRef.current.set(request.id, controller);

      try {
        const response = await fetch(request.path, {
          method: request.method,
          headers,
          body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
          signal: controller.signal
        });
        if (controller.signal.aborted || port !== portRef.current) return;
        const responseHeaders = boundedResponseHeaders(response.headers);
        const contentType = response.headers.get('content-type') || '';
        const isBinary = /^audio\//i.test(contentType);
        const responseBytes = await readResponseBytes(response);
        postBridgeResponse(port, request.id, {
          status: response.status,
          headers: responseHeaders,
          ...(isBinary ? { bodyBase64: bytesToBase64(responseBytes) } : { text: new TextDecoder().decode(responseBytes) })
        });
      } catch (_) {
        if (controller.signal.aborted || port !== portRef.current) return;
        postBridgeResponse(port, request.id, {
          status: 502,
          headers: { 'content-type': 'application/json' },
          text: JSON.stringify({ error: 'Novel panel API bridge failed' })
        });
      } finally {
        if (controllersRef.current.get(request.id) === controller) controllersRef.current.delete(request.id);
      }
    }

    function handleHandshake(event) {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (handshakeConsumedRef.current || !data || data.type !== 'qiantie-v77-handshake' || data.nonce !== sessionNonceRef.current) return;

      handshakeConsumedRef.current = true;
      const channel = new MessageChannel();
      const port1 = channel.port1;
      portRef.current = port1;
      channelLoadAcknowledgedRef.current = false;
      port1.onmessage = event => { void handlePortRequest(port1, event); };
      port1.start?.();
      event.source.postMessage({ type: 'qiantie-v77-port', nonce: sessionNonceRef.current }, '*', [channel.port2]);
      void requestWorkbenchCm('novel-panel-cm-context-request')
        .then(response => acceptCmContext(response?.context))
        .catch(() => {});
    }

    function handlePageShow(event) {
      if (!event.persisted) return;
      closePort();
      handshakeConsumedRef.current = false;
      channelLoadAcknowledgedRef.current = false;
    }

    window.addEventListener('message', handleHandshake);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('message', handleHandshake);
      window.removeEventListener('pageshow', handlePageShow);
      closePort();
    };
  }, []);

  function handleFrameLoad() {
    setLoading(false);
    syncTheme(frameRef.current, theme);
    if (!portRef.current) return;
    if (!channelLoadAcknowledgedRef.current) {
      channelLoadAcknowledgedRef.current = true;
      void requestWorkbenchCm('novel-panel-cm-context-request')
        .then(response => acceptCmContext(response?.context))
        .catch(() => {});
      return;
    }
    abortPendingRequests();
    rejectPendingCmCommands('小说工作台已重新加载。');
    portRef.current.onmessage = null;
    portRef.current.close();
    portRef.current = null;
    handshakeConsumedRef.current = false;
    channelLoadAcknowledgedRef.current = false;
    cmContextRef.current = { ready: false, workspace: null, selection: null, summary: '小说工作台正在重新连接。' };
    dispatchCmSelection(null);
    refreshCmBridgeContext();
  }

  return (
    <div className="novel-panel-page">
      {loading && !error ? <div className="novel-panel-status"><Spin tip="正在加载小说面板" /></div> : null}
      {error ? <Alert className="novel-panel-error" type="error" showIcon message="小说面板加载失败" /> : null}
      <iframe
        ref={frameRef}
        className="novel-panel-frame"
        title="小说面板"
        src={workbenchSrc}
        sandbox="allow-scripts allow-forms allow-downloads allow-modals"
        onLoad={handleFrameLoad}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
      />
    </div>
  );
}

export default NovelPanelPage;
