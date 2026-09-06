const EXECUTOR_PROTOCOL = 'yizhan-executor';
const ALLOWED_ACTIONS = new Set(['open', 'update']);

function parseExecutorProtocol(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== `${EXECUTOR_PROTOCOL}:`) return null;
  const hostAction = String(url.hostname || '').trim().toLowerCase();
  const pathAction = String(url.pathname || '').split('/').filter(Boolean)[0]?.trim().toLowerCase() || '';
  const action = hostAction || pathAction;
  if (!ALLOWED_ACTIONS.has(action)) return null;
  return { action };
}

function findExecutorProtocolAction(argv) {
  for (const value of Array.isArray(argv) ? argv : []) {
    const parsed = parseExecutorProtocol(value);
    if (parsed) return parsed;
  }
  return null;
}

function focusExecutorWindow(win) {
  if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) return false;
  if (typeof win.isMinimized === 'function' && win.isMinimized()) win.restore?.();
  if (typeof win.isVisible === 'function' && !win.isVisible()) win.show?.();
  win.focus?.();
  return true;
}

module.exports = {
  EXECUTOR_PROTOCOL,
  findExecutorProtocolAction,
  focusExecutorWindow,
  parseExecutorProtocol
};
