(() => {
  const apiPrefix = '/api/';
  const mountedApiPrefix = '/api/novel-panel/';
  const nativeFetch = window.fetch.bind(window);

  function rewrittenUrl(input) {
    const url = new URL(input, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith(apiPrefix) || url.pathname.startsWith(mountedApiPrefix)) {
      return null;
    }
    url.pathname = mountedApiPrefix + url.pathname.slice(apiPrefix.length);
    return url.toString();
  }

  window.fetch = function novelPanelFetch(input, init = {}) {
    const url = rewrittenUrl(input instanceof Request ? input.url : input instanceof URL ? input.href : input);
    if (!url) return nativeFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    for (const [name, value] of new Headers(init.headers || {})) headers.set(name, value);
    const token = localStorage.getItem('auth_token');
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    if (input instanceof Request) return nativeFetch(new Request(url, input), { ...init, headers });
    return nativeFetch(url, { ...init, headers });
  };
})();
