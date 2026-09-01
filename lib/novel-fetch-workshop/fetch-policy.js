const DEFAULT_ENDPOINT = 'https://txt.121w.com/api.php';

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampNumber(value, min, max, fallback) {
  return Math.min(max, Math.max(min, numberOr(value, fallback)));
}

function clampInteger(value, min, max, fallback) {
  return Math.floor(clampNumber(value, min, max, fallback));
}

function normalizeFetchPolicy(fetchConfig = {}) {
  const source = fetchConfig && typeof fetchConfig === 'object' ? fetchConfig : {};
  const endpoint = String(source.endpoint || DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT;
  return {
    endpoint,
    timeoutMs: Math.round(clampNumber(source.timeout_seconds, 1, 120, 30) * 1000),
    retries: clampInteger(source.retries, 0, 5, 1),
    concurrency: clampInteger(source.concurrency, 1, 32, 4)
  };
}

function emptyOriginalError() {
  const error = new Error('未获取到原文内容');
  error.code = 'EMPTY_ORIGINAL';
  error.recoverable = true;
  return error;
}

async function fetchWithPolicy({ fetchUpstream, bookId, platformId, maxTxt, fetchConfig } = {}) {
  if (typeof fetchUpstream !== 'function') {
    const error = new TypeError('fetchUpstream is required');
    error.recoverable = false;
    throw error;
  }

  const policy = normalizeFetchPolicy(fetchConfig);
  const maxAttempts = policy.retries + 1;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await fetchUpstream(bookId, platformId, maxTxt, {
        endpoint: policy.endpoint,
        timeoutMs: policy.timeoutMs,
        attempt
      });
      if (!result || typeof result.text !== 'string' || !result.text) throw emptyOriginalError();
      return { ...result, attempts: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      lastError.attempts = attempt;
      if (lastError.recoverable === false || attempt >= maxAttempts) throw lastError;
    }
  }

  throw lastError || new Error('原文抓取失败');
}

module.exports = {
  DEFAULT_ENDPOINT,
  normalizeFetchPolicy,
  fetchWithPolicy
};
