// 改文工作台：知识库数据层（高仿库 / 开头词库 / 改文模板）+ AI 条目优化
// 数据文件位于 <systemDir>/novel-fetch-knowledge/：
//   high_imitation.json / opening_phrases.json / rewrite_templates.json
// 规则库（layout_rules / symbol_rules / chapter_rules）复用 rules-knowledge/ 种子 JSON（只读）。
// 条目结构（简化对齐 Python 参考）：
//   高仿库     { title, source, style, content }
//   开头词库   { text, style, tags, source }
//   改文模板   { name, style, prompt }
//   统一附加 id，save 按 id 覆盖/追加，remove 按 id 删除。
// AI 调用复用 ./ai 的 chatCompletion / parseAiJsonContent；ai 与 settings 由调用方注入
// （真实场景路由用 resolveAiSettings 解析后注入，见 config.js）。
const fs = require('node:fs');
const path = require('node:path');
const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('../system-store');
const { chatCompletion, parseAiJsonContent } = require('./ai');

// ===== 常量 =====
const KNOWLEDGE_DIR_NAME = 'novel-fetch-knowledge';

const KNOWLEDGE_KINDS = ['high_imitation', 'opening_phrases', 'rewrite_templates'];
const RULE_KINDS = ['layout_rules', 'symbol_rules', 'chapter_rules'];
const ALL_KINDS = KNOWLEDGE_KINDS.concat(RULE_KINDS);

const KNOWLEDGE_FILE_NAMES = {
  high_imitation: 'high_imitation.json',
  opening_phrases: 'opening_phrases.json',
  rewrite_templates: 'rewrite_templates.json'
};
const RULES_DIR = path.join(__dirname, 'rules-knowledge');
const RULE_FILE_NAMES = {
  layout_rules: 'layout_rules.json',
  symbol_rules: 'symbol_rules.json',
  chapter_rules: 'chapter_rules.json'
};

// save 未携带 id 时按序号生成 id 的前缀
const KIND_ID_PREFIX = { high_imitation: 'hi', opening_phrases: 'opening', rewrite_templates: 'template' };

// AI 优化提示词里的库名与必填字段
const LIBRARY_NAMES = {
  high_imitation: '高仿文章库',
  opening_phrases: '爆款开头词库',
  rewrite_templates: '批量改文指令库'
};
const OPTIMIZE_REQUIRED_FIELDS = {
  high_imitation: ['title', 'source', 'style', 'content'],
  opening_phrases: ['text', 'style', 'tags', 'source'],
  rewrite_templates: ['name', 'style', 'prompt']
};

// ===== 辅助 =====
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanCell(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeItems(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

// 标签归一：数组 / 单个值 / 逗号分隔字符串 → 去重非空字符串数组
function normalizeTags(value) {
  const tags = [];
  for (const item of normalizeItems(value)) {
    for (const tag of String(item).split(/[,，、]/)) {
      const cleaned = tag.trim();
      if (cleaned && !tags.includes(cleaned)) tags.push(cleaned);
    }
  }
  return tags;
}

// 本地时间 ISO 字符串（含时区偏移），如 2026-08-18T12:34:56+08:00
function isoLocalTime(date) {
  const pad = value => String(value).padStart(2, '0');
  const d = new Date(date);
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// ===== 知识库 store =====
// systemDir：系统数据根目录（例如 data/system），知识库目录 = systemDir/novel-fetch-knowledge
function createKnowledgeStore({ systemDir } = {}) {
  if (typeof systemDir !== 'string' || !systemDir.trim()) throw new Error('systemDir is required');
  const resolvedSystemDir = path.resolve(systemDir);
  const knowledgeDir = path.join(resolvedSystemDir, KNOWLEDGE_DIR_NAME);

  function assertKnowledgeKind(kind) {
    if (!KNOWLEDGE_KINDS.includes(kind)) throw new Error('资料库类型无效：' + kind);
    return kind;
  }

  function assertKind(kind) {
    if (!ALL_KINDS.includes(kind)) throw new Error('资料库类型无效：' + kind);
    return kind;
  }

  function knowledgePath(kind) { return path.join(knowledgeDir, KNOWLEDGE_FILE_NAMES[kind]); }
  function rulePath(kind) { return path.join(RULES_DIR, RULE_FILE_NAMES[kind]); }

  // 读知识库：缺失时返回默认空结构 { source, updated_at, items }
  function readKnowledge(kind) {
    const result = readJsonOrMissing(knowledgePath(kind));
    return result.found && isPlainObject(result.value) ? result.value : { source: 'website', updated_at: '', items: [] };
  }

  // 读规则库（rules-knowledge 种子，只读）
  function readRules(kind) {
    const result = readJsonOrMissing(rulePath(kind));
    return result.found && result.value && typeof result.value === 'object' ? result.value : {};
  }

  // 条目规范化：保留各库规范字段 + id（未给 id 时按序号生成）
  function normalizeItem(kind, item, index) {
    const normalized = { id: cleanCell(item.id) || `${KIND_ID_PREFIX[kind]}_${String(index + 1).padStart(3, '0')}` };
    if (kind === 'high_imitation') {
      normalized.title = cleanCell(item.title);
      normalized.source = cleanCell(item.source);
      normalized.style = cleanCell(item.style);
      normalized.content = cleanCell(item.content);
    } else if (kind === 'opening_phrases') {
      normalized.text = cleanCell(item.text || item.general_phrase || item.content || item.template);
      normalized.style = cleanCell(item.style || item['适用风格类型'] || item.category);
      normalized.tags = normalizeTags(item.tags || item['标签']);
      normalized.source = cleanCell(item.source) || 'website';
    } else if (kind === 'rewrite_templates') {
      normalized.name = cleanCell(item.name);
      normalized.style = cleanCell(item.style);
      normalized.prompt = cleanCell(item.prompt);
    }
    return normalized;
  }

  function countKnowledgeItems(kind) {
    return readKnowledge(kind).items.filter(item => isPlainObject(item)).length;
  }

  // 规则库条目数：layout 按导入标记计 1，symbol/chapter 按规则条目数计
  function countRuleEntries(kind) {
    const data = readRules(kind);
    if (kind === 'layout_rules') return Object.keys(data).length > 0 ? 1 : 0;
    if (kind === 'symbol_rules') return normalizeItems(data.symbol_rules).length + normalizeItems(data.pair_fill_rules).length;
    if (kind === 'chapter_rules') return normalizeItems(data.chapter_exact_rules).length + normalizeItems(data.chapter_inline_rules).length;
    return 0;
  }

  // 列出指定库：知识库返回 { source, updated_at, items }，规则库返回种子 JSON 对象
  function list(kind) {
    assertKind(kind);
    return KNOWLEDGE_KINDS.includes(kind) ? readKnowledge(kind) : readRules(kind);
  }

  // 各库条目数汇总
  function getSummary() {
    const summary = {};
    for (const kind of KNOWLEDGE_KINDS) summary[kind] = countKnowledgeItems(kind);
    for (const kind of RULE_KINDS) summary[kind] = countRuleEntries(kind);
    return summary;
  }

  // 保存条目：带 id 覆盖已有，否则追加（自动生成 id）；规则库只读拒绝
  function save(kind, item) {
    assertKnowledgeKind(kind);
    if (!isPlainObject(item)) throw new Error('知识条目格式无效');
    const data = readKnowledge(kind);
    const normalized = normalizeItem(kind, item, data.items.length);
    const items = data.items.filter(i => isPlainObject(i));
    const targetId = normalized.id;
    let replaced = false;
    for (let i = 0; i < items.length; i++) {
      if (cleanCell(items[i].id) === targetId) {
        items[i] = normalized;
        replaced = true;
        break;
      }
    }
    if (!replaced) items.push(normalized);
    data.items = items;
    data.updated_at = isoLocalTime(new Date());
    if (kind === 'opening_phrases') {
      data.styles = [...new Set(items.map(i => cleanCell(i.style)).filter(Boolean))];
    }
    fs.mkdirSync(knowledgeDir, { recursive: true });
    withJsonLock(path.join(knowledgeDir, '.knowledge.lock'), () => {
      writeJsonAtomic(knowledgePath(kind), data);
    });
    return { ok: true, item: normalized };
  }

  // 删除条目：按 id 移除；规则库只读拒绝
  function remove(kind, id) {
    assertKnowledgeKind(kind);
    const targetId = cleanCell(id);
    const data = readKnowledge(kind);
    const before = data.items.length;
    const items = data.items.filter(i => !(isPlainObject(i) && cleanCell(i.id) === targetId));
    if (items.length === before) return { ok: true, removed: false };
    data.items = items;
    data.updated_at = isoLocalTime(new Date());
    if (kind === 'opening_phrases') {
      data.styles = [...new Set(items.map(i => cleanCell(i.style)).filter(Boolean))];
    }
    fs.mkdirSync(knowledgeDir, { recursive: true });
    withJsonLock(path.join(knowledgeDir, '.knowledge.lock'), () => {
      writeJsonAtomic(knowledgePath(kind), data);
    });
    return { ok: true, removed: true };
  }

  // 调 AI 优化条目并写回：id 保留，AI 返回的 item 中非空字段覆盖原值
  async function optimizeItem({ kind, id }, ai, settings) {
    assertKnowledgeKind(kind);
    const targetId = cleanCell(id);
    const data = readKnowledge(kind);
    const item = data.items.find(i => isPlainObject(i) && cleanCell(i.id) === targetId);
    if (!item) throw new Error('知识条目不存在');
    const chatFn = ai && typeof ai.chatCompletion === 'function' ? ai.chatCompletion : chatCompletion;
    const parseJson = ai && typeof ai.parseAiJsonContent === 'function' ? ai.parseAiJsonContent : parseAiJsonContent;
    const messages = [
      { role: 'system', content: '你是批量小说改文系统的提示词整理助手。只根据用户给的目标优化当前资料库条目，不要发散新功能。必须返回 JSON 对象，字段 item 内只放可保存字段。' },
      {
        role: 'user',
        content: JSON.stringify({
          library_name: LIBRARY_NAMES[kind],
          library_type: kind,
          current_item: item,
          user_goal: '让这个条目更适合批量自动改文，保留原意，输出更清楚。',
          required_fields: OPTIMIZE_REQUIRED_FIELDS[kind],
          rules: [
            '高仿文章库只整理参考内容和拆解，不要改成批量改文指令库模板。',
            '爆款开头词库要保留开头词可被指令模板调用的特点。',
            '批量改文指令库必须保留并优化 system_prompt 和 user_prompt_template。',
            '不要删除原有 id；没有把握的字段保持原值。'
          ],
          return_format: { item: Object.fromEntries(OPTIMIZE_REQUIRED_FIELDS[kind].map(field => [field, '优化后的字段值'])) }
        })
      }
    ];
    const response = await chatFn(settings, messages, { temperature: 0.35 });
    const parsed = parseJson((response && response.text) || '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !isPlainObject(parsed.item)) {
      throw new Error('AI返回格式不正确');
    }
    const optimized = { ...item, id: targetId };
    for (const [key, value] of Object.entries(parsed.item)) {
      if (hasValue(value)) optimized[key] = value;
    }
    save(kind, optimized);
    return { ok: true, item: optimized };
  }

  return { list, getSummary, save, remove, optimizeItem };
}

// 按 systemDir 缓存单例
const storeCache = new Map();
function getKnowledgeStore(systemDir) {
  const key = path.resolve(systemDir);
  if (!storeCache.has(key)) storeCache.set(key, createKnowledgeStore({ systemDir }));
  return storeCache.get(key);
}

module.exports = {
  createKnowledgeStore,
  getKnowledgeStore,
  KNOWLEDGE_DIR_NAME,
  KNOWLEDGE_FILE_NAMES,
  KNOWLEDGE_KINDS,
  RULE_KINDS,
  ALL_KINDS,
  normalizeTags,
  isoLocalTime
};
