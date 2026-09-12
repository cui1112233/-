export function getRouteAccessState({ pathname, isLoggedIn }) {
  const isProtectedRoute = pathname !== '/';
  return {
    canRenderPage: isLoggedIn || !isProtectedRoute,
    shouldPromptLogin: !isLoggedIn && isProtectedRoute
  };
}
