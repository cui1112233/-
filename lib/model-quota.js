const DEFAULT_TIMEOUT_MS = 8_000;

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percent(available, total) {
  if (available === null || total === null || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((available / total) * 100)));
}

function baseResult(model, status, checkedAt, extra = {}) {
  return {
    modelId: String(model?.id || ''),
    status,
    supported: model?.adapterKind === 'yfai_seedance',
    available: null,
    total: null,
    frozen: null,
    unit: '',
    percent: null,
    checkedAt,
    ...extra
  };
}

function isYfaiModel(model) {
  if (model?.adapterKind === 'yfai_seedance') return true;
  try {
    return /(^|\.)yf\.token6688\.com$/i.test(new URL(String(model?.baseUrl || '')).hostname);
  } catch {
    return false;
  }
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readYfaiQuota(model, { fetchImpl, now, timeoutMs }) {
  const checkedAt = now();
  if (!String(model?.credential || '').trim()) return baseResult(model, 'not_configured', checkedAt);
  let response;
  try {
    const baseUrl = String(model.baseUrl || 'https://yf.token6688.com').replace(/\/$/, '');
    response = await fetchWithTimeout(fetchImpl, `${baseUrl}/v1/skills/balance`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${String(model.credential).trim()}` }
    }, timeoutMs);
  } catch (error) {
    return baseResult(model, error?.name === 'AbortError' ? 'timeout' : 'error', checkedAt);
  }

  let payload = null;
  try { payload = await response.json(); } catch { /* provider may return an empty error body */ }
  if (response.status === 402 || payload?.error?.code === 'insufficient_funds') {
    return baseResult(model, 'depleted', checkedAt, { supported: true, available: 0, total: 0, frozen: 0, unit: 'CREDIT', percent: 0 });
  }
  if (response.status === 401 || response.status === 403) return baseResult(model, 'unauthorized', checkedAt);
  if (!response.ok) return baseResult(model, 'error', checkedAt);

  const credits = payload?.credits && typeof payload.credits === 'object' ? payload.credits : {};
  const total = numeric(credits.balance ?? payload?.balance);
  const frozen = numeric(credits.frozen ?? payload?.frozen);
  const available = numeric(credits.available ?? payload?.available_balance);
  if (available === null && total === null) return baseResult(model, 'unknown', checkedAt, { supported: true });
  const safeAvailable = available ?? Math.max(0, (total || 0) - (frozen || 0));
  const safeTotal = total ?? safeAvailable + (frozen || 0);
  return baseResult(model, safeAvailable <= 0 ? 'depleted' : 'available', checkedAt, {
    supported: true,
    available: safeAvailable,
    total: safeTotal,
    frozen: frozen || 0,
    unit: String(credits.unit || 'CREDIT'),
    percent: percent(safeAvailable, safeTotal)
  });
}

async function readModelQuota(model, { fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!model || typeof model !== 'object') return { modelId: '', status: 'unknown', supported: false, percent: null, checkedAt: now() };
  if (model.credentialMode === 'executorPairing') return baseResult(model, 'not_applicable', now(), { supported: false });
  if (!String(model.credential || '').trim()) return baseResult(model, 'not_configured', now());
  if (!isYfaiModel(model)) return baseResult(model, 'unknown', now(), { supported: false });
  if (typeof fetchImpl !== 'function') return baseResult(model, 'error', now(), { supported: true });
  return readYfaiQuota(model, { fetchImpl, now, timeoutMs });
}

async function readModelQuotas(models, options = {}) {
  return Promise.all((Array.isArray(models) ? models : []).map(model => readModelQuota(model, options)));
}

module.exports = { readModelQuota, readModelQuotas, percent };
