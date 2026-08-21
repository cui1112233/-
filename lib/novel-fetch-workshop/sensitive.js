// 改文工作台：敏感词处理（普通替换 + AI 片段修复）
// 分层设计：normalizeSensitiveRules（词表归一：数组 / {groups} 结构 + scope 过滤）、
// applySensitiveReplace（普通模式 find→replace 全局替换）、sensitiveSnippetSpan / findSensitiveHits
// （按断句符切 ±context 字上下文，按 span 分组）、extractSensitiveFixedText / neutralizeSensitiveSnippet
// （AI 返回解析 / 失败回落中性替换词）、rebuildTextWithFixes（按 span 回拼原文）、
// processSensitiveText（编排：普通模式 / AI 模式并发修复）。
// AI 调用复用 ./ai 的 chatCompletion / parseAiJsonContent（ai 可注入 mock，供测试与路由复用）。
const { chatCompletion, parseAiJsonContent } = require('./ai');
const { DEFAULT_WORKSHOP_CONFIG } = require('./config');

// 断句符：命中片段按这些字符切分上下文
const SENSITIVE_BREAK_CHARS = '\n。！？!?；;…';
// 右引号类符号：片段右边界延伸到其后（把收尾引号包进片段）
const SENSITIVE_RIGHT_QUOTES = '”’」』】）)》';
// 内置中性替换词（无配置替换词时的兜底）
const SENSITIVE_NEUTRAL_REPLACEMENTS = { '小三': '第三者', '逼': '害', '玩': '相处' };
const NEUTRAL_FALLBACK = '合规表达';
const DEFAULT_SYSTEM_PROMPT = '你是内容合规改写助手。只改写用户给出的命中片段，保持原意，去掉违规、擦边、色情、低俗表达。';

// 判断普通对象（排除数组 / null）
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// ===== 词表归一 =====
// 支持三种形态：
//   数组：[{ find, replace, enabled, apply_to_original, apply_to_ai }]
//   { groups: [{ name, enabled, apply_to_original, apply_to_ai, rules: [...] }] }（组开关关闭跳过、组级 scope 默认值继承给组内规则）
//   { rules: [...] }（无分组时的兼容形态）
function normalizeSensitiveRules(value) {
  const rules = [];
  const pushRule = (item, groupDefaults = {}) => {
    if (!isPlainObject(item)) return;
    const find = String(item.find || '').trim();
    if (!find) return;
    if (item.enabled === false) return;
    const applyToOriginal = item.apply_to_original !== undefined
      ? item.apply_to_original !== false
      : (groupDefaults.apply_to_original !== undefined ? groupDefaults.apply_to_original !== false : true);
    const applyToAi = item.apply_to_ai !== undefined
      ? item.apply_to_ai !== false
      : (groupDefaults.apply_to_ai !== undefined ? groupDefaults.apply_to_ai !== false : true);
    rules.push({
      find,
      replace: String(item.replace || ''),
      enabled: true,
      apply_to_original: applyToOriginal,
      apply_to_ai: applyToAi
    });
  };

  if (Array.isArray(value)) {
    for (const item of value) pushRule(item);
  } else if (isPlainObject(value)) {
    if (Array.isArray(value.groups) && value.groups.length) {
      for (const group of value.groups) {
        if (!isPlainObject(group) || group.enabled === false) continue;
        const defaults = { apply_to_original: group.apply_to_original, apply_to_ai: group.apply_to_ai };
        for (const item of Array.isArray(group.rules) ? group.rules : []) pushRule(item, defaults);
      }
    } else if (Array.isArray(value.rules)) {
      for (const item of value.rules) pushRule(item);
    }
  }
  return rules;
}

// 按 scope（original / ai / both）过滤启用规则
function activeSensitiveRules(value, scope) {
  const rules = normalizeSensitiveRules(value);
  const s = String(scope || 'original');
  return rules.filter(rule => {
    if (s === 'original' && rule.apply_to_original === false) return false;
    if (s === 'ai' && rule.apply_to_ai === false) return false;
    return true;
  });
}

// 从 settings 解析敏感词清单：settings.keywords > settings.config.sensitive > 空
function resolveSensitiveSource(settings) {
  const config = settings && isPlainObject(settings.config) ? settings.config : {};
  if (settings && settings.keywords !== undefined && settings.keywords !== null) return settings.keywords;
  if (config.sensitive !== undefined && config.sensitive !== null) return config.sensitive;
  return [];
}

// ===== 普通替换 =====
// 字面量全局替换（split/join 避免正则特殊字符语义），与 Python str.replace 行为一致
function applySensitiveReplace(text, rules) {
  let result = String(text == null ? '' : text);
  for (const rule of rules) {
    if (!rule || !rule.find) continue;
    result = result.split(rule.find).join(rule.replace || '');
  }
  return result;
}

// ===== 断句切分 =====
// 命中位置 start..end 的 snippet 区间 [left, right)：
// 左边界取 start 前最近的断句符之后，否则回退 start-contextChars；
// 右边界取 end 起最近的断句符之后（含右侧引号收尾），否则回退 end+contextChars。
function sensitiveSnippetSpan(text, start, end, contextChars = 12) {
  const source = String(text == null ? '' : text);
  const chars = Math.max(0, Math.floor(Number(contextChars) || 0));
  let left = -1;
  for (const ch of SENSITIVE_BREAK_CHARS) {
    const index = source.lastIndexOf(ch, Math.max(0, start - 1));
    if (index > left) left = index;
  }
  if (left >= 0) left += 1;
  else left = Math.max(0, start - chars);

  let right = -1;
  for (const ch of SENSITIVE_BREAK_CHARS) {
    const index = source.indexOf(ch, end);
    if (index >= 0 && (right < 0 || index < right)) right = index;
  }
  if (right >= 0) right += 1;
  else right = Math.min(source.length, end + chars);
  while (right < source.length && SENSITIVE_RIGHT_QUOTES.includes(source[right])) right += 1;
  return [left, right];
}

// ===== 找命中 =====
// 按 span 分组（同一片段内多个关键词合并），返回 [{ start, end, keywords, snippet, hit_index, keyword }]
function findSensitiveHits(text, rules, { maxHits = 0, contextChars = 12 } = {}) {
  const source = String(text == null ? '' : text);
  const grouped = new Map();
  const max = Math.max(0, Math.floor(Number(maxHits) || 0));
  for (const rule of rules) {
    const keyword = rule && rule.find ? String(rule.find) : '';
    if (!keyword) continue;
    let searchFrom = 0;
    for (;;) {
      const index = source.indexOf(keyword, searchFrom);
      if (index < 0) break;
      const span = sensitiveSnippetSpan(source, index, index + keyword.length, contextChars);
      const key = `${span[0]}:${span[1]}`;
      let hit = grouped.get(key);
      if (!hit) {
        hit = { start: span[0], end: span[1], keywords: [], snippet: source.slice(span[0], span[1]) };
        grouped.set(key, hit);
      }
      if (!hit.keywords.includes(keyword)) hit.keywords.push(keyword);
      searchFrom = index + Math.max(1, keyword.length);
      if (max && grouped.size >= max) break;
    }
    if (max && grouped.size >= max) break;
  }
  const hits = Array.from(grouped.values()).sort((a, b) => a.start - b.start || a.end - b.end);
  hits.forEach((hit, index) => {
    hit.hit_index = index + 1;
    hit.keyword = hit.keywords.join('、');
  });
  return hits;
}

// ===== AI 返回解析 =====
// 1) JSON 对象取 fixed_text/text/content/result/output 首个非空字符串；2) JSON 数组逐项取 text/字符串 join；
// 3) 代码块围栏剥除；4) 其余按纯文本 trim。
function extractSensitiveFixedText(content) {
  const text = String(content == null ? '' : content).trim();
  const parsed = parseAiJsonContent(text);
  if (Array.isArray(parsed)) {
    const parts = parsed
      .map(item => (isPlainObject(item) ? String(item.text || '').trim() : String(item).trim()))
      .filter(Boolean);
    if (parts.length) return parts.join('\n');
  } else if (isPlainObject(parsed)) {
    for (const key of ['fixed_text', 'text', 'content', 'result', 'output']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  const fenceMatch = text.match(/```(?:json|text)?\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  return text;
}

// ===== 中性回落 =====
// 配置了替换词用替换词，否则内置中性替换词，最后兜底「合规表达」
function configuredSensitiveReplacement(rules, keyword) {
  for (const rule of rules) {
    if (rule && rule.find === keyword && rule.replace) return rule.replace;
  }
  return '';
}

function neutralizeSensitiveSnippet(snippet, keywordText, rules) {
  let result = String(snippet == null ? '' : snippet);
  const keywords = String(keywordText || '').split(/[、,，|/]+/);
  for (const keyword of keywords) {
    const kw = keyword.trim();
    if (!kw) continue;
    const replacement = configuredSensitiveReplacement(rules, kw) || SENSITIVE_NEUTRAL_REPLACEMENTS[kw] || NEUTRAL_FALLBACK;
    result = result.split(kw).join(replacement);
  }
  return result;
}

// ===== 回拼 =====
// 按 span 排序，把 done/fallback 的修复结果替换进原文对应区间
function rebuildTextWithFixes(text, hits, fixedItems) {
  const byIndex = new Map();
  for (const item of fixedItems) {
    if (item && (item.status === 'done' || item.status === 'fallback')) {
      byIndex.set(Number(item.hit_index) || 0, item);
    }
  }
  const pieces = [];
  let cursor = 0;
  const sorted = hits.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  for (const hit of sorted) {
    const start = Number(hit.start) || 0;
    const end = Number(hit.end) || start;
    if (start < cursor) continue;
    const fixed = byIndex.get(Number(hit.hit_index) || 0);
    if (!fixed) continue;
    pieces.push(text.slice(cursor, start));
    pieces.push(String(fixed.after || ''));
    cursor = end;
  }
  pieces.push(text.slice(cursor));
  return pieces.join('');
}

// prompt 模板变量填充：{key} 替换
function fillPromptTemplate(template, variables) {
  let result = String(template || '');
  for (const [key, value] of Object.entries(variables || {})) {
    result = result.split(`{${key}}`).join(String(value || ''));
  }
  return result;
}

// ===== 单个命中 AI 修复 =====
// 重试 retries 次，成功后 extractSensitiveFixedText 提取改写文本；
// 全部失败回落 neutralizeSensitiveSnippet（有实际变化记 fallback，无变化记 failed）。
async function repairSensitiveHit({ settings, hit, rules, ai }) {
  const cfg = settings || {};
  const template = String(cfg.prompt || DEFAULT_WORKSHOP_CONFIG.sensitive_ai.prompt);
  const variables = {
    book_id: cfg.bookId || '',
    book_name: cfg.bookName || '',
    style: cfg.style || '',
    gender: cfg.gender || '',
    keyword: hit.keyword || '',
    snippet: hit.snippet || '',
    hit_index: hit.hit_index || ''
  };
  const userPrompt = fillPromptTemplate(template, variables);
  const messages = [
    { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt }
  ];
  const retries = Math.max(0, Math.floor(Number(cfg.retries) || 1));
  const temperature = Number(cfg.temperature) || 0.2;
  const aiSettings = cfg.aiSettings || {};
  const chatFn = ai && typeof ai.chatCompletion === 'function' ? ai.chatCompletion : chatCompletion;

  let lastError = '';
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const response = await chatFn(aiSettings, messages, { temperature });
      const content = (response && response.text) || '';
      const fixed = extractSensitiveFixedText(content);
      if (!fixed) throw new Error('AI返回内容为空');
      return {
        hit_index: hit.hit_index,
        keyword: hit.keyword,
        before: hit.snippet,
        after: fixed,
        status: 'done',
        attempt,
        error: ''
      };
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
    }
  }
  const fallbackText = neutralizeSensitiveSnippet(String(hit.snippet || ''), String(hit.keyword || ''), rules);
  const fallbackChanged = fallbackText !== String(hit.snippet || '');
  return {
    hit_index: hit.hit_index,
    keyword: hit.keyword,
    before: hit.snippet,
    after: fallbackText,
    status: fallbackText && fallbackChanged ? 'fallback' : 'failed',
    error: lastError
  };
}

// ===== 主编排 =====
// settings：{ keywords | config, enabled(开关 AI 模式), scope, context_chars, max_hits, concurrency,
//             retries, temperature, prompt, bookId/bookName/style/gender, aiSettings }
// ai：注入 { chatCompletion }（默认用 ./ai）。
// 普通模式：find→replace 全局替换，fixedCount = 命中片段数。
// AI 模式：按断句切 snippet（±context_chars 字上下文），并发调 AI 改写，失败回落中性替换词，按 span 拼回原文。
async function processSensitiveText({ text, settings, ai } = {}) {
  const cfg = settings || {};
  const scope = String(cfg.scope || 'original');
  const rules = activeSensitiveRules(resolveSensitiveSource(cfg), scope);
  const contextChars = Math.max(0, Math.floor(Number(cfg.context_chars) || 12));
  const maxHits = Math.max(0, Math.floor(Number(cfg.max_hits != null ? cfg.max_hits : cfg.max_hits_per_task) || 80));
  const source = String(text == null ? '' : text);

  if (!cfg.enabled) {
    // 普通模式：先统计命中，再全局替换
    const hits = findSensitiveHits(source, rules, { maxHits, contextChars });
    const replaced = applySensitiveReplace(source, rules);
    return { text: replaced, hits, fixedCount: hits.length };
  }

  // AI 模式
  const hits = findSensitiveHits(source, rules, { maxHits, contextChars });
  if (!hits.length) return { text: source, hits, fixedCount: 0 };

  const concurrency = Math.max(1, Math.floor(Number(cfg.concurrency) || 4));
  const fixedItems = [];
  const queue = hits.slice();
  const workerCount = Math.min(concurrency, queue.length);
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const hit = queue.shift();
      if (!hit) return;
      fixedItems.push(await repairSensitiveHit({ settings: cfg, hit, rules, ai }));
    }
  });
  await Promise.all(workers);

  fixedItems.sort((a, b) => (Number(a.hit_index) || 0) - (Number(b.hit_index) || 0));
  const fixedCount = fixedItems.filter(item => item.status === 'done' || item.status === 'fallback').length;
  const repaired = rebuildTextWithFixes(source, hits, fixedItems);
  return { text: repaired, hits, fixedCount };
}

module.exports = {
  processSensitiveText,
  normalizeSensitiveRules,
  activeSensitiveRules,
  applySensitiveReplace,
  sensitiveSnippetSpan,
  findSensitiveHits,
  extractSensitiveFixedText,
  neutralizeSensitiveSnippet,
  rebuildTextWithFixes,
  repairSensitiveHit,
  SENSITIVE_NEUTRAL_REPLACEMENTS
};
