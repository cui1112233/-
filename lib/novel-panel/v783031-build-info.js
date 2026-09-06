'use strict';

const V783031_BUILD_INFO_PATCH = Object.freeze({
  app_version: 'v78.3.0.31',
  build_date: '2026-09-06',
  build_id: 'v78.3.0.31-final-semantics-20260906-r1',
  workspace_schema_version: 40,
  release_channel: 'stable',
  release_version: 'v78.3.0.31',
  release_status: 'production',
  clean_core_phase: 'v78_3_0_31_final_semantics',
  director_semantic_contract: 'v78_3_0_20_21_authoritative_audit',
  source_transaction: 'v78_3_0_22_atomic_fence',
  generation_input_transaction: 'v78_3_0_23_revision_fingerprint_fence',
  current_truth_policy: 'v78_3_0_24_28_direct_current_truth_no_stale_recovery',
  patch_regeneration: 'v78_3_0_27_28_duration_locked_current_truth',
  professional_cinematography: 'v78_3_0_30_reference_director_grammar',
  style_field_boundary: 'v78_3_0_31_field_boundary_validator',
});

function createV783031BuildInfoMiddleware() {
  return function v783031BuildInfoMiddleware(req, res, next) {
    if (String(req.method || 'GET').toUpperCase() !== 'GET') return next();
    const originalJson = res.json.bind(res);
    res.json = function v783031BuildInfoJson(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body)) return originalJson(body);
      return originalJson({ ...body, ...V783031_BUILD_INFO_PATCH });
    };
    return next();
  };
}

module.exports = {
  V783031_BUILD_INFO_PATCH,
  createV783031BuildInfoMiddleware,
};
