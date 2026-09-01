function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function bool(value, fallback = false) { return value === undefined ? fallback : value === true; }
function int(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}
function sensitiveMode(value, enabled) {
  const mode = String(value || '').trim();
  if (['replace', 'ai_each', 'ai_group'].includes(mode)) return mode;
  return enabled === false ? 'replace' : 'ai_each';
}

function normalizeWorkflowPolicy(config = {}) {
  const source = object(config);
  const fetch = object(source.fetch);
  const workflow = object(source.workflow);
  const storage = object(source.storage);
  const webSubmit = object(source.web_submit);
  const ai = object(source.ai);
  const sensitive = object(source.sensitive_ai);
  const sensitiveEnabled = bool(sensitive.enabled, true);
  return {
    fetch: {
      min_original_chars: int(fetch.min_original_chars, 0, 0, 1000000),
      skip_short_original: bool(fetch.skip_short_original, false)
    },
    workflow: {
      auto_sync_site_styles: bool(workflow.auto_sync_site_styles, false),
      auto_reclassify_invalid_style: bool(workflow.auto_reclassify_invalid_style, false)
    },
    storage: {
      cleanup_enabled: bool(storage.cleanup_enabled, false),
      retention_days: int(storage.retention_days, 30, 1, 3650)
    },
    web_submit: {
      batch_size: int(webSubmit.batch_size, 20, 1, 500),
      flush_seconds: int(webSubmit.flush_seconds, 0, 0, 300)
    },
    ai: {
      force_serial_batch: bool(ai.force_serial_batch, false)
    },
    sensitive_ai: {
      enabled: sensitiveEnabled,
      mode: sensitiveMode(sensitive.mode, sensitiveEnabled)
    }
  };
}

function shortOriginalDecision(text, fetchPolicy = {}) {
  const chars = [...String(text || '')].length;
  const minChars = int(fetchPolicy.min_original_chars, 0, 0, 1000000);
  return { chars, skipped: bool(fetchPolicy.skip_short_original, false) && minChars > 0 && chars < minChars };
}

function shouldReclassifyStyle(style, catalog, enabled) {
  if (!enabled) return false;
  const value = String(style || '').trim();
  const allowed = new Set((Array.isArray(catalog) ? catalog : []).map(item => String(item || '').trim()).filter(Boolean));
  return !value || !allowed.has(value);
}

function effectiveRewriteConcurrency(aiConfig = {}) {
  if (aiConfig.force_serial_batch === true) return 1;
  return Math.max(1, Math.floor(Number(aiConfig.max_concurrency) || 1));
}

function splitSubmitBatches(ids, batchSize) {
  const source = Array.isArray(ids) ? ids : [];
  const size = int(batchSize, 20, 1, 500);
  const batches = [];
  for (let index = 0; index < source.length; index += size) batches.push(source.slice(index, index + size));
  return batches;
}

module.exports = {
  normalizeWorkflowPolicy,
  shortOriginalDecision,
  shouldReclassifyStyle,
  effectiveRewriteConcurrency,
  splitSubmitBatches
};
