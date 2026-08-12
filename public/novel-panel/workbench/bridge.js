(() => {
  const apiPrefix = '/api/';
  const mountedApiPrefix = '/api/novel-panel/';
  const allowedHeaders = new Set(['content-type', 'cache-control', 'pragma', 'x-videoprompttool-session']);
  const nonce = new URLSearchParams(window.location.search).get('nonce');
  const pendingRequests = new Map();
  const nativeFetch = window.fetch.bind(window);
  const nativeSendBeacon = typeof navigator.sendBeacon === 'function'
    ? navigator.sendBeacon.bind(navigator)
    : null;
  let channelPort = null;
  let handshakeRetryTimer = null;

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

  function postPendingRequest(pending) {
    channelPort.postMessage({ type: 'novel-panel-api-request', id: pending.id, ...pending.request });
  }

  function requestParentApi(request) {
    const id = nextRequestId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error('Novel panel API bridge timed out.'));
      }, 30000);
      const pending = { id, request, resolve, reject, timer };
      pendingRequests.set(id, pending);
      if (channelPort) postPendingRequest(pending);
    });
  }

  function rejectPendingRequests() {
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Novel panel API bridge closed.'));
    }
    pendingRequests.clear();
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
    if (event.source !== window.parent || channelPort) return;
    const data = event.data;
    const port = event.ports?.[0];
    if (!data || data.type !== 'qiantie-v77-port' || data.nonce !== nonce || !port) return;
    channelPort = port;
    stopHandshakeRetries();
    channelPort.onmessage = message => {
      const response = message.data;
      if (!response || response.type !== 'novel-panel-api-response' || typeof response.id !== 'string') return;
      const pending = pendingRequests.get(response.id);
      if (!pending) return;
      pendingRequests.delete(response.id);
      clearTimeout(pending.timer);
      const status = Number.isInteger(response.status) && response.status >= 200 && response.status <= 599 ? response.status : 500;
      pending.resolve(new Response(typeof response.text === 'string' ? response.text : '', { status, headers: response.headers || {} }));
    };
    channelPort.start?.();
    for (const pending of pendingRequests.values()) postPendingRequest(pending);
  });

  function closeBridge() {
    stopHandshakeRetries();
    channelPort?.close();
    channelPort = null;
    rejectPendingRequests();
  }

  window.addEventListener('pagehide', closeBridge);
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    closeBridge();
    startHandshakeRetries();
  });
  window.addEventListener('beforeunload', closeBridge);

  startHandshakeRetries();

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
