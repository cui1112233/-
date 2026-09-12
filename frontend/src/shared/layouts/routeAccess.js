export function getRouteAccessState({ pathname, isLoggedIn }) {
  const isProtectedRoute = pathname !== '/';
  return {
    canRenderPage: isLoggedIn || !isProtectedRoute,
    shouldPromptLogin: !isLoggedIn && isProtectedRoute
  };
}

export function shouldPromptLoginForApiFailure({ status, sessionAuthFailure } = {}) {
  return status === 401 && sessionAuthFailure === true;
}
