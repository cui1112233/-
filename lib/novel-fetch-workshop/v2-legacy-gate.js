const V2_OWNED_LEGACY_MUTATIONS = Object.freeze(new Set([
  'POST /process/start',
  'POST /tasks/reprocess-sensitive',
  'POST /web-submit/config',
  'POST /web-submit/sync-configs',
  'POST /web-submit/sync-styles',
  'POST /web-submit/test-visible',
  'POST /web-submit/preview',
  'POST /web-submit/submit'
]));

function mutationKey(req = {}) {
  const method = String(req.method || '').trim().toUpperCase();
  const path = String(req.path || req.url || '').split('?')[0].trim();
  return `${method} ${path}`;
}

function isV2OwnedLegacyMutation(req = {}) {
  return V2_OWNED_LEGACY_MUTATIONS.has(mutationKey(req));
}

function legacyV2MutationGate() {
  return (req, res, next) => {
    if (!isV2OwnedLegacyMutation(req)) return next();
    return res.status(409).json({
      ok: false,
      code: 'V2_ROUTE_REQUIRED',
      error: '该操作已由 Novel Fetch V2 接管，旧 Node mutation 已禁用'
    });
  };
}

module.exports = { V2_OWNED_LEGACY_MUTATIONS, mutationKey, isV2OwnedLegacyMutation, legacyV2MutationGate };
