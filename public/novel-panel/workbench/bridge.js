(() => {
  const apiPrefix = '/api/';
  const mountedApiPrefix = '/api/novel-panel/';
  const nativeFetch = window.fetch.bind(window);
  const nativeSendBeacon = navigator.sendBeacon.bind(navigator);

  function apiUrl(input) {
    try {
      const url = new URL(input, window.location.origin);
      if (url.origin !== window.location.origin || !url.pathname.startsWith(apiPrefix)) return null;
      if (!url.pathname.startsWith(mountedApiPrefix)) {
        url.pathname = mountedApiPrefix + url.pathname.slice(apiPrefix.length);
      }
      return url;
    } catch (_) {
      return null;
    }
  }

  function withAuthorization(headers) {
    const token = localStorage.getItem('auth_token');
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    return headers;
  }

  function beaconPayload(data) {
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      return { body: data, contentType: data.type };
    }
    if (typeof data === 'string') {
      const trimmed = data.trim();
      return {
        body: data,
        contentType: trimmed.startsWith('{') || trimmed.startsWith('[')
          ? 'application/json'
          : 'text/plain;charset=UTF-8'
      };
    }
    if (data == null) return { body: '', contentType: 'text/plain;charset=UTF-8' };
    return { body: JSON.stringify(data), contentType: 'application/json' };
  }

  window.fetch = function novelPanelFetch(input, init = {}) {
    const url = apiUrl(input instanceof Request ? input.url : input instanceof URL ? input.href : input);
    if (!url) return nativeFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    for (const [name, value] of new Headers(init.headers || {})) headers.set(name, value);
    withAuthorization(headers);
    if (input instanceof Request) return nativeFetch(new Request(url.toString(), input), { ...init, headers });
    return nativeFetch(url.toString(), { ...init, headers });
  };

  navigator.sendBeacon = function novelPanelSendBeacon(endpoint, data) {
    const url = apiUrl(endpoint);
    if (!url) return nativeSendBeacon(endpoint, data);

    const { body, contentType } = beaconPayload(data);
    const headers = withAuthorization(new Headers());
    if (contentType) headers.set('Content-Type', contentType);
    try {
      Promise.resolve(nativeFetch(url.toString(), {
        method: 'POST',
        body,
        headers,
        keepalive: true
      })).catch(() => {});
    } catch (_) {
      // Beacon delivery is best effort and must not break V77 unload handling.
    }
    return true;
  };
})();
