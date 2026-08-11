(() => {
  const apiPrefix = '/api/';
  const mountedApiPrefix = '/api/novel-panel/';
  const allowedHeaders = new Set(['content-type', 'cache-control', 'pragma', 'x-videoprompttool-session']);
  const pendingRequests = new Map();
  const nativeFetch = window.fetch.bind(window);
  const nativeSendBeacon = typeof navigator.sendBeacon === 'function'
    ? navigator.sendBeacon.bind(navigator)
    : null;

  function apiPath(input) {
    try {
      const value = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const currentUrl = new URL(window.location.href);
      const url = new URL(value, currentUrl);
      if (url.origin !== currentUrl.origin || !url.pathname.startsWith(apiPrefix)) return null;
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

  function nextRequestId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `v77-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function requestParentApi(request) {
    const id = nextRequestId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error('Novel panel API bridge timed out.'));
      }, 30000);
      pendingRequests.set(id, { resolve, reject, timer });
      window.parent.postMessage({ type: 'novel-panel-api-request', id, ...request }, '*');
    });
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

  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== 'novel-panel-api-response' || typeof data.id !== 'string') return;
    const pending = pendingRequests.get(data.id);
    if (!pending) return;
    pendingRequests.delete(data.id);
    clearTimeout(pending.timer);
    const status = Number.isInteger(data.status) && data.status >= 200 && data.status <= 599 ? data.status : 500;
    pending.resolve(new Response(typeof data.text === 'string' ? data.text : '', { status, headers: data.headers || {} }));
  });

  window.fetch = function novelPanelFetch(input, init = {}) {
    const path = apiPath(input);
    if (!path) return nativeFetch(input, init);
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers = allowedRequestHeaders(init.headers || (input instanceof Request ? input.headers : undefined));
    const hasBody = Object.prototype.hasOwnProperty.call(init, 'body');
    if (input instanceof Request && !hasBody && method !== 'GET' && method !== 'HEAD') {
      return input.clone().text().then(body => requestParentApi({ path, method, headers, body }));
    }
    return requestParentApi({ path, method, headers, body: hasBody ? init.body : undefined });
  };

  navigator.sendBeacon = function novelPanelSendBeacon(endpoint, data) {
    const path = apiPath(endpoint);
    if (!path) return nativeSendBeacon ? nativeSendBeacon(endpoint, data) : false;
    const payload = beaconPayload(data);
    requestParentApi({ path, method: 'POST', headers: payload.headers, body: payload.body }).catch(() => {});
    return true;
  };
})();
