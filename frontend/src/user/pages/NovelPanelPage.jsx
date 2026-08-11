import { Alert, Spin } from 'antd';
import { useEffect, useRef, useState } from 'react';
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
  target.postMessage({ type: 'novel-panel-api-response', id, ...response }, '*');
}

export function NovelPanelPage() {
  const frameRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function handleBridgeRequest(event) {
      if (event.source !== frameRef.current?.contentWindow) return;
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
        postBridgeResponse(event.source, request.id, {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          text: await response.text()
        });
      } catch (_) {
        postBridgeResponse(event.source, request.id, {
          status: 502,
          headers: { 'content-type': 'application/json' },
          text: JSON.stringify({ error: 'Novel panel API bridge failed' })
        });
      }
    }

    window.addEventListener('message', handleBridgeRequest);
    return () => window.removeEventListener('message', handleBridgeRequest);
  }, []);

  return (
    <div className="novel-panel-page">
      {loading && !error ? <div className="novel-panel-status"><Spin tip="正在加载小说面板" /></div> : null}
      {error ? <Alert className="novel-panel-error" type="error" showIcon message="小说面板加载失败" /> : null}
      <iframe
        ref={frameRef}
        className="novel-panel-frame"
        title="小说面板"
        src="/novel-panel/workbench"
        sandbox="allow-scripts allow-forms allow-downloads"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
      />
    </div>
  );
}
