// 改文工作台：规则排版管线（8 阶段）+ AI 生成规则建议
// 分层设计：阶段纯函数（applyChapterCleanup / normalizeRepeatedPunctuation / applySymbolTrim /
// fillPairSymbols / applyParagraphStyle）+ 编排（processDocumentText 完整管线、processDocumentTrace
// 分阶段 trace）+ AI 规则建议（suggestRulesWithAi：6 类规则 schema + 字段白名单校验）。
// knowledge 来自 rules-knowledge/ 三份种子 JSON（layout_rules / symbol_rules / chapter_rules），
// 缺省时按 __dirname/rules-knowledge 读取默认值；调用方可注入自定义 knowledge 覆盖。
// 敏感词替换阶段复用 ./sensitive（普通替换），词表由 layout.sensitiveKeywords 或 knowledge.sensitive_rules 提供。
const path = require('node:path');
const { readJsonOrMissing } = require('../system-store');
const { normalizeNewlines } = require('./tasks');
const { normalizeSensitiveRules, applySensitiveReplace } = require('./sensitive');
const { chatCompletion, parseAiJsonContent } = require('./ai');

// ===== 知识库默认值 =====
const KNOWLEDGE_DIR = path.join(__dirname, 'rules-knowledge');
const KNOWLEDGE_FILE_NAMES = ['layout_rules', 'symbol_rules', 'chapter_rules'];

function loadKnowledgeDefaults() {
  const defaults = {};
  for (const name of KNOWLEDGE_FILE_NAMES) {
    const result = readJsonOrMissing(path.join(KNOWLEDGE_DIR, `${name}.json`));
    defaults[name] = result.found && result.value && typeof result.value === 'object' ? result.value : {};
  }
  return defaults;
}

const DEFAULT_KNOWLEDGE = loadKnowledgeDefaults();

// 合并调用方 knowledge 与默认值（缺键用默认种子）
function mergeKnowledge(knowledge) {
  const k = knowledge && typeof knowledge === 'object' ? knowledge : {};
  return {
    layout_rules: k.layout_rules || DEFAULT_KNOWLEDGE.layout_rules,
    symbol_rules: k.symbol_rules || DEFAULT_KNOWLEDGE.symbol_rules,
    chapter_rules: k.chapter_rules || DEFAULT_KNOWLEDGE.chapter_rules
  };
}

// 工作台此前把“已保存的处理配置”拆散传入不同入口：抓取、AI 改文、预览和手动应用会各自
// 取一部分，导致同一条规则的实际效果不一致。此处把用户配置还原为规则管线唯一上下文。
function configuredRuleContext(config) {
  const source = config && typeof config === 'object' ? config : {};
  const savedLayout = source.layout && typeof source.layout === 'object' ? source.layout : {};
  const savedKnowledge = source.knowledge && typeof source.knowledge === 'object' ? source.knowledge : {};
  const layout = { ...savedLayout };

  // 敏感词在工作台配置中独立存放；规则引擎只从 layout.sensitiveKeywords 读取，
  // 因此在唯一入口合并一次，且让原文/AI 的 scope 开关继续由规则本身决定。
  if (source.sensitive !== undefined) layout.sensitiveKeywords = source.sensitive;

  return {
    layout,
    knowledge: {
      layout_rules: savedKnowledge.layout_rules,
      symbol_rules: savedKnowledge.symbol_rules,
      chapter_rules: savedKnowledge.chapter_rules
    }
  };
}

// ===== 通用辅助 =====
function textLines(text) {
  return normalizeNewlines(text).split('\n');
}

function parsePositiveInt(value, fallback) {
  const number = Math.floor(Number(String(value == null ? '' : value).trim()));
  return Number.isFinite(number) ? number : fallback;
}

function normalizeItems(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

// 启用规则：元素为对象且 enabled !== false
function enabledRules(value) {
  return normalizeItems(value).filter(item => item && typeof item === 'object' && item.enabled !== false);
}

// 位置解析：数组或按空白/中英文逗号/顿号/竖线/斜杠分割，取正数去重
function parsePositions(value) {
  const rawItems = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[\s,，、|/]+/);
  const positions = [];
  for (const item of rawItems) {
    const number = parsePositiveInt(item, 0);
    if (number > 0 && !positions.includes(number)) positions.push(number);
  }
  return positions;
}

// 正则匹配（模拟 Python re.match：从头匹配）；非法正则回落字符串全等比较
function safePatternMatch(pattern, line) {
  const p = String(pattern || '');
  const source = p.startsWith('^') ? p : `^(?:${p})`;
  try {
    return new RegExp(source).test(String(line));
  } catch (_) {
    return p.trim() === String(line).trim();
  }
}

function textHasContent(text) {
  return /[\w\u4e00-\u9fff]/.test(String(text || ''));
}

// ===== 章节清洗 =====
// 整行命中 exact 规则（或开启 inline 时命中 inline 规则）→ 置为空行
function applyChapterCleanup(text, layout, chapterRules) {
  const chapter = chapterRules || {};
  if (layout && layout.apply_chapter_cleanup === false) return text;
  if (chapter.chapter_cleanup_enabled === false) return text;
  const removeStandalone = chapter.chapter_remove_standalone !== false;
  const removeInline = chapter.chapter_remove_inline === true;
  const exactRules = enabledRules(chapter.chapter_exact_rules).concat(enabledRules(chapter.chapter_builtin_exact_rules));
  const inlineRules = enabledRules(chapter.chapter_inline_rules).concat(enabledRules(chapter.chapter_builtin_inline_rules));
  const out = [];
  for (const raw of textLines(text)) {
    if (!raw.trim()) {
      out.push(raw);
      continue;
    }
    let shouldRemove = false;
    if (removeStandalone) {
      shouldRemove = exactRules.some(rule => safePatternMatch(rule.find, raw));
    }
    if (!shouldRemove && removeInline) {
      shouldRemove = inlineRules.some(rule => safePatternMatch(rule.find, raw));
    }
    out.push(shouldRemove ? '' : raw);
  }
  return out.join('\n');
}

// ===== 重复标点压缩 =====
const REPEATED_PUNCTUATION_RULES = [
  [/。{2,}/g, '。'],
  [/，{2,}/g, '，'],
  [/！{2,}/g, '！'],
  [/？{2,}/g, '？'],
  [/、{2,}/g, '、'],
  [/\.{3,}/g, '...']
];

function normalizeRepeatedPunctuation(text) {
  let result = String(text == null ? '' : text);
  for (const [pattern, replacement] of REPEATED_PUNCTUATION_RULES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ===== 字位符号规则（按指定字位拆行）=====
const OPENING_SYMBOLS_ATTACH_RIGHT = new Set('“‘「『【《〈（(['.split(''));
const RIGHT_QUOTES_CAN_OPEN = new Set('”’」』'.split(''));
const PAIR_OPENING_CONTEXT = new Set(' \t:：,，。！？?；;、'.split(''));

function symbolTrimAvailable(symbolRules, layout) {
  if (layout && layout.apply_symbol_rules === false) return false;
  if (symbolRules.enable_symbol_trim === false) return false;
  if (!parsePositions(symbolRules.symbol_trim_positions).length) return false;
  const triggers = new Set(enabledRules(symbolRules.symbol_rules).map(rule => String(rule.find || '')).filter(Boolean));
  return triggers.size > 0;
}

// 符号是否吸附右侧（左括号类恒吸附；右引号类在前文为标点/空白且后文有内容时吸附）
function symbolAttachesRight(line, index, symbol) {
  if (OPENING_SYMBOLS_ATTACH_RIGHT.has(symbol)) return true;
  if (!RIGHT_QUOTES_CAN_OPEN.has(symbol)) return false;
  const previous = index > 0 ? line[index - 1] : '';
  const after = line.slice(index + symbol.length);
  return (index === 0 || PAIR_OPENING_CONTEXT.has(previous)) && textHasContent(after);
}

function appendTextPart(out, value) {
  const text = String(value == null ? '' : value).trim();
  if (text && textHasContent(text)) out.push(text);
}

function applySymbolTrim(text, layout, symbolRules) {
  if (layout && layout.apply_symbol_rules === false) return text;
  if (symbolRules.enable_symbol_trim === false) return text;
  const positions = parsePositions(symbolRules.symbol_trim_positions);
  if (!positions.length) return text;
  const triggers = new Set(enabledRules(symbolRules.symbol_rules).map(rule => String(rule.find || '')).filter(Boolean));
  if (!triggers.size) return text;
  const allowAdjacent = Boolean(symbolRules.symbol_trim_allow_adjacent);
  const out = [];
  for (const line of textLines(text)) {
    const queue = [line];
    while (queue.length) {
      const current = queue.shift();
      let matchedIndex = -1;
      for (const position of positions) {
        const candidateIndexes = allowAdjacent ? [position - 2, position - 1, position] : [position - 1];
        for (const index of candidateIndexes) {
          if (index >= 0 && index < current.length && triggers.has(current[index])) {
            matchedIndex = index;
            break;
          }
        }
        if (matchedIndex >= 0) break;
      }
      if (matchedIndex < 0) {
        out.push(current);
        continue;
      }
      const symbol = current[matchedIndex];
      let left;
      let right;
      if (symbolAttachesRight(current, matchedIndex, symbol)) {
        left = current.slice(0, matchedIndex).trim();
        right = current.slice(matchedIndex).trim();
      } else {
        left = current.slice(0, matchedIndex + 1).trim();
        right = current.slice(matchedIndex + 1).trim();
      }
      appendTextPart(out, left);
      if (right && textHasContent(right)) {
        if (right === current) {
          // 防死循环：吸附型符号拆不出右侧内容时原样保留
          out.push(current);
          break;
        }
        queue.unshift(right);
      }
    }
  }
  return out.join('\n');
}

// 行断策略：字位符号规则可用时启用拆行，否则原样返回
function applyLineBreakStrategy(text, layout, layoutRules, symbolRules) {
  if (symbolTrimAvailable(symbolRules, layout)) return applySymbolTrim(text, layout, symbolRules);
  return text;
}

// ===== 成对补符号 =====
// 缺失右符补右符；缺失左符时（右符在行首/标点后且后文有内容）把右符转左符再补右符，否则行首补左符
function fillPairSymbols(text, layout, symbolRules) {
  if (layout && layout.apply_pair_fill === false) return text;
  const rules = enabledRules(symbolRules.pair_fill_rules);
  if (!rules.length) return text;
  const fullText = normalizeNewlines(text);
  const activePairs = rules
    .map(rule => ({ find: String(rule.find || ''), replace: String(rule.replace || '') }))
    .filter(pair => pair.find && pair.replace && (fullText.includes(pair.find) || fullText.includes(pair.replace)));
  if (!activePairs.length) return text;
  const out = [];
  for (const raw of textLines(text)) {
    let line = raw.trim();
    if (!line) {
      out.push('');
      continue;
    }
    for (const { find: left, replace: right } of activePairs) {
      if (line.startsWith(left + right) && textHasContent(line.slice(left.length + right.length))) {
        line = left + line.slice(left.length + right.length);
        if (!line.slice(left.length).includes(right)) line += right;
      } else if (line.includes(left) && !line.includes(right)) {
        line += right;
      } else if (line.includes(right) && !line.includes(left)) {
        const rightIndex = line.indexOf(right);
        const previous = rightIndex > 0 ? line[rightIndex - 1] : '';
        const after = line.slice(rightIndex + right.length);
        if ((rightIndex === 0 || PAIR_OPENING_CONTEXT.has(previous)) && textHasContent(after)) {
          line = line.slice(0, rightIndex) + left + line.slice(rightIndex + right.length);
          if (!line.slice(rightIndex + left.length).includes(right)) line += right;
        } else {
          line = left + line;
        }
      }
    }
    if (!textHasContent(line)) out.push('');
    else out.push(line);
  }
  return out.join('\n');
}

// ===== 段落样式 =====
// 每段前插 indent_spaces 空格、段间插 blank_lines_before 空行；drop_empty_lines 丢弃空行；trim_lines 裁首尾空白
function applyParagraphStyle(text, layout, layoutRules) {
  const rules = layoutRules || {};
  const indentSpaces = Math.max(0, parsePositiveInt(rules.indent_spaces, 0));
  const blankLinesBefore = Math.max(0, parsePositiveInt(rules.blank_lines_before, 0));
  const dropEmptyLines = layout && layout.drop_empty_lines !== undefined
    ? Boolean(layout.drop_empty_lines)
    : (rules.drop_empty_lines !== undefined ? Boolean(rules.drop_empty_lines) : true);
  const trimLines = !layout || layout.trim_lines === undefined ? true : Boolean(layout.trim_lines);
  const out = [];
  let first = true;
  for (const raw of textLines(text)) {
    const line = trimLines ? raw.trim() : raw.replace(/\s+$/, '');
    if (!line.trim()) {
      if (!dropEmptyLines) out.push('');
      continue;
    }
    if (!first) {
      for (let i = 0; i < blankLinesBefore; i++) out.push('');
    }
    out.push(' '.repeat(indentSpaces) + line);
    first = false;
  }
  return out.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

// ===== scope 归一 =====
function normalizeScope(scope) {
  const s = String(scope == null ? 'original' : scope).trim();
  return s === 'ai' ? 'ai' : 'original';
}

// 敏感词规则来源：layout.sensitiveKeywords > knowledge.sensitive_rules > 空
function sensitiveRulesFor(layout, knowledge) {
  const raw = (layout && layout.sensitiveKeywords) || (knowledge && knowledge.sensitive_rules) || [];
  return normalizeSensitiveRules(raw);
}

// ===== trace 样本 =====
// 逐行对比 before/after，最多 limit 条 { before, after }
function ruleTraceSamples(before, after, limit = 8) {
  const beforeLines = textLines(before);
  const afterLines = textLines(after);
  const samples = [];
  const maxIndex = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < maxIndex; index++) {
    const beforeLine = index < beforeLines.length ? beforeLines[index] : '';
    const afterLine = index < afterLines.length ? afterLines[index] : '';
    if (beforeLine === afterLine) continue;
    samples.push({ before: beforeLine, after: afterLine });
    if (samples.length >= limit) break;
  }
  return samples;
}

function ruleStage(name, title, text, before) {
  return {
    stage: name,
    title,
    chars: String(text == null ? '' : text).length,
    lines: textLines(text).length,
    changed: before !== undefined && before !== text,
    samples: before !== undefined ? ruleTraceSamples(before, text) : []
  };
}

// ===== 完整管线 =====
// 8 阶段：normalize_newlines → sensitive 替换（可开关）→ chapter_cleanup → 重复标点压缩 →
// symbol_trim → pair_fill → 重复标点2 → chapter_cleanup2 → paragraph_style
function processDocumentText(text, scope, layoutConfig, knowledge) {
  const layout = layoutConfig || {};
  const k = mergeKnowledge(knowledge);
  const layoutRules = k.layout_rules || {};
  const symbolRules = k.symbol_rules || {};
  const chapterRules = k.chapter_rules || {};
  const scopeName = normalizeScope(scope);

  let result = normalizeNewlines(text);
  if (scopeName === 'original' && layout.apply_to_original === false) return result;
  if (scopeName === 'ai' && layout.apply_to_ai === false) return result;

  // 敏感词替换（可开关；AI 模式对原文跳过——AI 修复由 sensitive.js 的 processSensitiveText 负责）
  if (layout.apply_sensitive !== false && layoutRules.apply_sensitive_replace !== false) {
    if (!(scopeName === 'original' && layout.sensitive_ai_enabled)) {
      const rules = sensitiveRulesFor(layout, k);
      if (rules.length) result = applySensitiveReplace(result, rules);
    }
  }
  result = applyChapterCleanup(result, layout, chapterRules);
  result = normalizeRepeatedPunctuation(result);
  result = applyLineBreakStrategy(result, layout, layoutRules, symbolRules);
  result = fillPairSymbols(result, layout, symbolRules);
  result = normalizeRepeatedPunctuation(result);
  result = applyChapterCleanup(result, layout, chapterRules);
  return applyParagraphStyle(result, layout, layoutRules);
}

// 分阶段 trace：每阶段 { stage, chars, lines, changed, samples: [{ before, after }] }
function processDocumentTrace(text, scope, layoutConfig, knowledge) {
  const layout = layoutConfig || {};
  const k = mergeKnowledge(knowledge);
  const layoutRules = k.layout_rules || {};
  const symbolRules = k.symbol_rules || {};
  const chapterRules = k.chapter_rules || {};
  const scopeName = normalizeScope(scope);

  let result = normalizeNewlines(text);
  const stages = [ruleStage('raw', '抓取原文/raw', result)];
  if (scopeName === 'original' && layout.apply_to_original === false) return stages;
  if (scopeName === 'ai' && layout.apply_to_ai === false) return stages;

  if (layout.apply_sensitive !== false && layoutRules.apply_sensitive_replace !== false) {
    if (!(scopeName === 'original' && layout.sensitive_ai_enabled)) {
      const rules = sensitiveRulesFor(layout, k);
      if (rules.length) {
        const before = result;
        result = applySensitiveReplace(result, rules);
        stages.push(ruleStage('sensitive', '敏感词替换', result, before));
      }
    }
  }

  let before = result;
  result = applyChapterCleanup(result, layout, chapterRules);
  stages.push(ruleStage('chapter_1', '章节清洗-首次', result, before));
  before = result;
  result = normalizeRepeatedPunctuation(result);
  stages.push(ruleStage('punctuation_1', '重复标点清理-首次', result, before));
  before = result;
  result = applyLineBreakStrategy(result, layout, layoutRules, symbolRules);
  stages.push(ruleStage('symbol_trim', '字位符号规则', result, before));
  before = result;
  result = fillPairSymbols(result, layout, symbolRules);
  stages.push(ruleStage('pair_fill', '成对补符号规则', result, before));
  before = result;
  result = normalizeRepeatedPunctuation(result);
  stages.push(ruleStage('punctuation_2', '重复标点清理-二次', result, before));
  before = result;
  result = applyChapterCleanup(result, layout, chapterRules);
  stages.push(ruleStage('chapter_2', '章节清洗-二次', result, before));
  before = result;
  result = applyParagraphStyle(result, layout, layoutRules);
  stages.push(ruleStage('paragraph', '批量排版规则', result, before));
  return stages;
}

function processConfiguredDocumentText(text, scope, config) {
  const { layout, knowledge } = configuredRuleContext(config);
  return processDocumentText(text, scope, layout, knowledge);
}

function processConfiguredDocumentTrace(text, scope, config) {
  const { layout, knowledge } = configuredRuleContext(config);
  return processDocumentTrace(text, scope, layout, knowledge);
}

// ===== AI 生成规则建议 =====
const SUGGEST_RULE_TYPES = ['sensitive', 'layout_rules', 'chapter_exact_rules', 'chapter_inline_rules', 'symbol_rules', 'pair_fill_rules'];

const RULE_AI_NAMES = {
  sensitive: '敏感词AI助手',
  layout_rules: '批量排版AI助手',
  chapter_exact_rules: '章节整行清洗AI助手',
  chapter_inline_rules: '章节行内清洗AI助手',
  symbol_rules: '字位符号AI助手',
  pair_fill_rules: '成对补符号AI助手'
};

// 6 类规则 schema（提示 AI 返回形态）
const RULE_AI_SCHEMAS = {
  sensitive: {
    rules: [{ find: '要查找/命中的敏感词', replace: '关闭AI处理时才使用的替换内容，可留空', enabled: true }],
    note: '只提取确实需要处理的敏感词或违规词。开启敏感词AI处理时，replace 不参与原文处理。'
  },
  layout_rules: {
    layout_rules: { indent_spaces: 0, blank_lines_before: 0, apply_sensitive_replace: true },
    layout: { drop_empty_lines: true, trim_lines: true, apply_sensitive: true, apply_chapter_cleanup: true, apply_symbol_rules: true, apply_pair_fill: true },
    note: '批量排版不负责换行；需要换行时请使用字位符号规则。'
  },
  chapter_exact_rules: {
    chapter_exact_rules: [{ find: '^第[一二三四五六七八九十百千万0-9]+章.*$', replace: '', enabled: true }],
    chapter_inline_rules: [],
    settings: { chapter_cleanup_enabled: true, chapter_remove_standalone: true, chapter_remove_inline: false }
  },
  chapter_inline_rules: {
    chapter_exact_rules: [],
    chapter_inline_rules: [{ find: '^第[一二三四五六七八九十百千万0-9]+章', replace: '', enabled: true }],
    settings: { chapter_cleanup_enabled: true, chapter_remove_standalone: true, chapter_remove_inline: true }
  },
  symbol_rules: {
    symbol_rules: [{ find: '异常符号', replace: '', enabled: true }],
    settings: { enable_symbol_trim: true, symbol_trim_positions: '1,2', symbol_trim_allow_adjacent: true }
  },
  pair_fill_rules: {
    pair_fill_rules: [{ find: '“', replace: '”', enabled: true }]
  }
};

function ruleAiSchema(ruleType) {
  return RULE_AI_SCHEMAS[ruleType] || RULE_AI_SCHEMAS.sensitive;
}

const RULE_AI_HINTS = [
  '敏感词规则必须有 find、enabled；replace 可留空，只有关闭敏感词AI处理时才会用于普通替换。',
  '章节规则的 find 可以是正则表达式，replace 通常为空。',
  '字位符号规则的 find 是单个或少量符号，位置参数放到 settings。',
  '成对补符号规则 find 是左符号，replace 是右符号。',
  '排版规则只返回参数，不返回具体正文。',
  '只生成确实有用、可直接加入系统规则的内容。'
];

// 规则列表白名单：仅保留 { find, replace, enabled }，find 非空
function cleanRuleList(value) {
  const rules = [];
  for (const item of normalizeItems(value)) {
    if (!item || typeof item !== 'object') continue;
    const find = String(item.find || '').trim();
    if (!find) continue;
    rules.push({ find, replace: String(item.replace || ''), enabled: item.enabled !== false });
  }
  return rules;
}

// 按规则类型白名单校验 AI 返回（丢弃未允许的字段）
function normalizeAiRuleSuggestions(ruleType, parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI返回不是规则对象');
  }
  const result = { rule_type: ruleType };
  if (ruleType === 'sensitive') {
    result.rules = cleanRuleList(parsed.rules || parsed.sensitive_rules);
  } else if (ruleType === 'layout_rules') {
    const layoutRules = parsed.layout_rules && typeof parsed.layout_rules === 'object' ? parsed.layout_rules : {};
    const layout = parsed.layout && typeof parsed.layout === 'object' ? parsed.layout : {};
    result.layout_rules = {};
    for (const key of ['indent_spaces', 'blank_lines_before', 'apply_sensitive_replace']) {
      if (Object.hasOwn(layoutRules, key)) result.layout_rules[key] = layoutRules[key];
    }
    result.layout = {};
    for (const key of ['drop_empty_lines', 'trim_lines', 'apply_sensitive', 'apply_chapter_cleanup', 'apply_symbol_rules', 'apply_pair_fill']) {
      if (Object.hasOwn(layout, key)) result.layout[key] = layout[key];
    }
  } else if (ruleType === 'chapter_exact_rules' || ruleType === 'chapter_inline_rules') {
    result.chapter_exact_rules = cleanRuleList(parsed.chapter_exact_rules);
    result.chapter_inline_rules = cleanRuleList(parsed.chapter_inline_rules);
    result.settings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {};
  } else if (ruleType === 'symbol_rules') {
    result.symbol_rules = cleanRuleList(parsed.symbol_rules);
    result.settings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {};
  } else if (ruleType === 'pair_fill_rules') {
    result.pair_fill_rules = cleanRuleList(parsed.pair_fill_rules);
  }
  return result;
}

// 调 AI 生成规则建议（可指定单类 options.ruleType，缺省生成 6 类）
// ai：注入 { chatCompletion, parseAiJsonContent? }；settings 由 options.settings 或 ai.settings 提供（真实场景由路由用 resolveAiSettings 解析后注入）
async function suggestRulesWithAi(ai, sampleText, options = {}) {
  const ruleTypes = options.ruleType ? [String(options.ruleType).trim()] : SUGGEST_RULE_TYPES.slice();
  for (const ruleType of ruleTypes) {
    if (!RULE_AI_NAMES[ruleType]) throw new Error('规则类型无效');
  }
  const sample = String(sampleText == null ? '' : sampleText);
  const needsSample = ruleTypes.some(ruleType => ruleType !== 'layout_rules');
  if (!sample.trim() && needsSample) throw new Error('请输入样本文案');

  const settings = (options && options.settings) || (ai && ai.settings) || {};
  const chatFn = ai && typeof ai.chatCompletion === 'function' ? ai.chatCompletion : chatCompletion;
  const parseJson = ai && typeof ai.parseAiJsonContent === 'function' ? ai.parseAiJsonContent : parseAiJsonContent;

  const systemPrompt = '你是改文规则生成助手。你只负责生成当前规则类型可以直接保存使用的规则。不要输出解释，不要输出Markdown，只输出JSON对象。';
  const requiredJson = options.ruleType
    ? { [String(options.ruleType).trim()]: ruleAiSchema(String(options.ruleType).trim()) }
    : RULE_AI_SCHEMAS;
  const userContent = JSON.stringify({
    rule_types: ruleTypes,
    sample_text: sample,
    user_goal: (options && options.goal) || '根据样本文案生成可用规则。',
    current_config: (options && options.currentConfig) || {},
    required_json: requiredJson,
    rules: RULE_AI_HINTS
  });
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ];

  const response = await chatFn(settings, messages, { temperature: 0.2 });
  const content = (response && response.text) || '';
  const parsed = parseJson(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI返回不是规则对象');
  }

  const suggestions = {};
  for (const ruleType of ruleTypes) {
    const section = parsed[ruleType] && typeof parsed[ruleType] === 'object' ? parsed[ruleType] : parsed;
    suggestions[ruleType] = normalizeAiRuleSuggestions(ruleType, section);
  }
  return { ok: true, suggestions };
}

module.exports = {
  processDocumentText,
  processDocumentTrace,
  configuredRuleContext,
  processConfiguredDocumentText,
  processConfiguredDocumentTrace,
  suggestRulesWithAi,
  normalizeAiRuleSuggestions,
  cleanRuleList,
  ruleAiSchema,
  SUGGEST_RULE_TYPES,
  // 阶段函数（供测试 / 路由复用）
  applyChapterCleanup,
  normalizeRepeatedPunctuation,
  applySymbolTrim,
  fillPairSymbols,
  applyParagraphStyle,
  applyLineBreakStrategy,
  // 辅助
  textLines,
  safePatternMatch,
  parsePositions,
  enabledRules,
  ruleTraceSamples,
  ruleStage,
  loadKnowledgeDefaults,
  mergeKnowledge,
  DEFAULT_KNOWLEDGE
};
