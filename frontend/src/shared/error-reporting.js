const MAX_REPORT_LENGTH = 4000;
const MAX_CONTEXT_LENGTH = 12000;

function clean(value) {
  return String(value || '').slice(0, MAX_REPORT_LENGTH);
}

function cleanContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try {
    const text = JSON.stringify(value);
    if (text.length > MAX_CONTEXT_LENGTH) return { truncated: true, summary: text.slice(0, MAX_CONTEXT_LENGTH) };
    return JSON.parse(text);
  } catch (_) {
    return undefined;
  }
}

function serializeReason(reason) {
  if (reason instanceof Error) return { message: reason.message, stack: reason.stack || '' };
  if (typeof reason === 'string') return { message: reason, stack: '' };
  try {
    return { message: JSON.stringify(reason), stack: '' };
  } catch (_) {
    return { message: 'Unknown browser error', stack: '' };
  }
}

export function reportClientError({ kind = 'error', message, stack, source, method, status, context } = {}) {
  const payload = JSON.stringify({
    kind: clean(kind),
    message: clean(message),
    stack: clean(stack),
    source: clean(source),
    path: window.location.pathname,
    method: clean(method),
    status: Number.isInteger(status) ? status : undefined,
    context: cleanContext(context)
  });

  try {
    const token = localStorage.getItem('auth_token') || '';
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: payload,
      keepalive: true
    }).catch(() => {});
  } catch (_) {
    // Reporting cannot be allowed to create a second browser failure.
  }
}

export function installClientErrorReporting() {
  window.addEventListener('error', event => {
    reportClientError({
      kind: 'window-error',
      message: event.message,
      stack: event.error?.stack,
      source: event.filename
    });
  });

  window.addEventListener('unhandledrejection', event => {
    const reason = serializeReason(event.reason);
    reportClientError({ kind: 'unhandledrejection', ...reason });
  });
}
