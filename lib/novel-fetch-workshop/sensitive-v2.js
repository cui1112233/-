const base = require('./sensitive');
const aiModule = require('./ai');

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function sensitiveSource(settings = {}) {
  if (settings.keywords !== undefined && settings.keywords !== null) return settings.keywords;
  return object(settings.config).sensitive || [];
}
function modeFor(settings = {}) {
  const mode = String(settings.mode || '').trim();
  if (['replace', 'ai_each', 'ai_group'].includes(mode)) return mode;
  return settings.enabled === false ? 'replace' : 'ai_each';
}
function withFallbackFlag(item) {
  return { ...item, fallback_from_ai: item?.status === 'fallback' };
}

async function processAiGroup({ text, settings, ai } = {}) {
  const cfg = settings || {};
  const scope = String(cfg.scope || 'original');
  const rules = base.activeSensitiveRules(sensitiveSource(cfg), scope);
  const contextChars = Math.max(0, Math.floor(Number(cfg.context_chars) || 12));
  const maxHits = Math.max(0, Math.floor(Number(cfg.max_hits != null ? cfg.max_hits : cfg.max_hits_per_task) || 80));
  const source = String(text == null ? '' : text);
  const hits = base.findSensitiveHits(source, rules, { maxHits, contextChars });
  if (!hits.length) return { text: source, hits: [], fixedItems: [], fixedCount: 0, mode: 'ai_group' };

  const chat = ai && typeof ai.chatCompletion === 'function' ? ai.chatCompletion : aiModule.chatCompletion;
  const parseJson = ai && typeof ai.parseAiJsonContent === 'function' ? ai.parseAiJsonContent : aiModule.parseAiJsonContent;
  const retries = Math.max(0, Math.floor(Number(cfg.retries) || 1));
  const messages = [
    { role: 'system', content: '你是内容合规批量改写助手。逐项改写命中片段，保留原意，只输出 JSON。' },
    { role: 'user', content: JSON.stringify({
      items: hits.map(hit => ({ hit_index: hit.hit_index, keyword: hit.keyword, snippet: hit.snippet })),
      required_format: { items: [{ hit_index: 1, fixed_text: '改写后的片段' }] }
    }) }
  ];

  let lastError = '';
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const response = await chat(cfg.aiSettings || {}, messages, { temperature: Number(cfg.temperature) || 0.2 });
      const parsed = parseJson(response?.text || '');
      const rows = Array.isArray(parsed?.items) ? parsed.items : [];
      const byIndex = new Map(rows.map(item => [Number(item?.hit_index), String(item?.fixed_text || item?.text || '').trim()]));
      const fixedItems = hits.map(hit => {
        const fixed = byIndex.get(Number(hit.hit_index));
        if (fixed) return { hit_index: hit.hit_index, keyword: hit.keyword, before: hit.snippet, after: fixed, status: 'done', attempt, error: '', fallback_from_ai: false };
        const fallback = base.neutralizeSensitiveSnippet(hit.snippet, hit.keyword, rules);
        return { hit_index: hit.hit_index, keyword: hit.keyword, before: hit.snippet, after: fallback, status: 'fallback', attempt, error: 'AI批量结果未覆盖该片段', fallback_from_ai: true };
      });
      const repaired = base.rebuildTextWithFixes(source, hits, fixedItems);
      return { text: repaired, hits, fixedItems, fixedCount: fixedItems.length, mode: 'ai_group' };
    } catch (error) {
      lastError = error?.message || String(error);
    }
  }

  const fixedItems = hits.map(hit => {
    const fallback = base.neutralizeSensitiveSnippet(hit.snippet, hit.keyword, rules);
    const changed = fallback !== hit.snippet;
    return {
      hit_index: hit.hit_index, keyword: hit.keyword, before: hit.snippet, after: fallback,
      status: changed ? 'fallback' : 'failed', error: lastError, fallback_from_ai: true
    };
  });
  const repaired = base.rebuildTextWithFixes(source, hits, fixedItems);
  return { text: repaired, hits, fixedItems, fixedCount: fixedItems.filter(item => item.status === 'fallback').length, mode: 'ai_group' };
}

async function processSensitiveTextV2({ text, settings, ai } = {}) {
  const mode = modeFor(settings || {});
  if (mode === 'ai_group') return processAiGroup({ text, settings: { ...(settings || {}), enabled: true, mode }, ai });
  if (mode === 'replace') {
    const result = await base.processSensitiveText({ text, settings: { ...(settings || {}), enabled: false }, ai });
    return { ...result, mode: 'replace', fixedItems: (result.fixedItems || []).map(withFallbackFlag) };
  }
  const result = await base.processSensitiveText({ text, settings: { ...(settings || {}), enabled: true }, ai });
  return { ...result, mode: 'ai_each', fixedItems: (result.fixedItems || []).map(item => ({ ...withFallbackFlag(item), fallback_from_ai: item?.status === 'fallback' })) };
}

module.exports = { modeFor, processAiGroup, processSensitiveTextV2 };
