const BLOCKED_MUTATIONS = new Set([
  'POST /web-submit/config',
  'POST /web-submit/sync-configs',
  'POST /web-submit/sync-styles',
  'POST /web-submit/test-visible',
  'POST /web-submit/submit',
  'POST /process'
]);

function requestKey(req = {}) {
  const method = String(req.method || 'GET').toUpperCase();
  const path = String(req.path || req.url || '').split('?')[0] || '/';
  return `${method} ${path}`;
}

function createLegacy121MutationGuard() {
  return function legacy121MutationGuard(req, res, next) {
    if (!BLOCKED_MUTATIONS.has(requestKey(req))) return next();
    return res.status(410).json({
      ok: false,
      code: 'legacy_121_mutation_disabled',
      error: '旧版 121 写入通道已停用，请使用 Novel Fetch V2 Browser Worker。'
    });
  };
}

module.exports = { BLOCKED_MUTATIONS, requestKey, createLegacy121MutationGuard };
