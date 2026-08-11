import { Alert, Spin } from 'antd';
import { useLayoutEffect, useRef, useState } from 'react';
import { getToken } from '../../shared/api/client';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const ALLOWED_HEADERS = new Set(['content-type', 'cache-control', 'pragma', 'x-videoprompttool-session']);

function normalizeBridgeRequest(data) {
  if (!data || data.type !== 'novel-panel-api-request' || typeof data.id !== 'string' || typeof data.path !== 'string') return null;
  const method = String(data.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method) || !data.path.startsWith('/api/novel-panel/')) return null;
  const url = new URL(data.path, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/novel-panel/')) return null;

  const headers = {};
  for (const [name, value] of Object.entries(data.headers || {})) {
    if (ALLOWED_HEADERS.has(name.toLowerCase()) && typeof value === 'string') headers[name] = value;
  }
  return { id: data.id, path: url.pathname + url.search, method, headers, body: data.body };
}

function postBridgeResponse(target, id, response) {
  target.postMessage({ type: 'novel-panel-api-response', id, ...response });
}

function createSessionNonce() {
  const values = new Uint8Array(24);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return Array.from(values, value => value.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function NovelPanelPage() {
  const frameRef = useRef(null);
  const sessionNonceRef = useRef(createSessionNonce());
  const handshakeConsumedRef = useRef(false);
  const portRef = useRef(null);
  const channelLoadAcknowledgedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const workbenchSrc = `/novel-panel/workbench?nonce=${encodeURIComponent(sessionNonceRef.current)}`;

  useLayoutEffect(() => {
    function closePort() {
      if (!portRef.current) return;
      portRef.current.onmessage = null;
      portRef.current.close();
      portRef.current = null;
    }

    async function handlePortRequest(port, event) {
      if (port !== portRef.current) return;
      const request = normalizeBridgeRequest(event.data);
      if (!request) return;

      const headers = new Headers(request.headers);
      headers.delete('Authorization');
      const token = getToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);

      try {
        const response = await fetch(request.path, {
          method: request.method,
          headers,
          body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body
        });
        if (port !== portRef.current) return;
        postBridgeResponse(port, request.id, {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          text: await response.text()
        });
      } catch (_) {
        if (port !== portRef.current) return;
        postBridgeResponse(port, request.id, {
          status: 502,
          headers: { 'content-type': 'application/json' },
          text: JSON.stringify({ error: 'Novel panel API bridge failed' })
        });
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
    }

    window.addEventListener('message', handleHandshake);
    return () => {
      window.removeEventListener('message', handleHandshake);
      closePort();
    };
  }, []);

  function handleFrameLoad() {
    setLoading(false);
    if (!portRef.current) return;
    if (!channelLoadAcknowledgedRef.current) {
      channelLoadAcknowledgedRef.current = true;
      return;
    }
    portRef.current.close();
    portRef.current = null;
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
