// 改文工作台：爆款开头词模块（AI 拆解 / 保存 / 规范化）
// 数据文件与 knowledge.js 共用 <systemDir>/novel-fetch-knowledge/opening_phrases.json。
// analyze：调 AI 把爆款开头原文拆解为可入库的开头词条目（返回 { ok, items }）；
// save：按 id 覆盖/追加保存到 opening_phrases.json；
// normalize：规范化开头词库（按 text 去重、按 style 归类），返回 { ok, removed, grouped }。
// 条目结构：{ id, text, style, tags, source }。
const fs = require('node:fs');
const path = require('node:path');
const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('../system-store');
const { chatCompletion, parseAiJsonContent } = require('./ai');
const { STYLE_NAMES } = require('../../routes/novel-fetch');
const { KNOWLEDGE_DIR_NAME, KNOWLEDGE_FILE_NAMES, isoLocalTime } = require('./knowledge');

// ===== 默认拆解器配置（对齐 Python default_opening_analyzer_config）=====
const DEFAULT_ANALYZER = {
  name: '爆款开头拆解',
  version: 'website-20260818',
  system_prompt: '你是中文推文小说爆款开头拆解与入库模板专家。你的任务不是改写新文案，而是把爆款开头或有趣话题文案拆成后续 AI 改文可直接读取的开头骨架模板。必须只返回 JSON 对象，不要解释。',
  user_prompt_template: '【爆款文案 / 话题原文】\n{source_text}\n\n【当前适用风格类型】\n{current_style}\n\n【网站固定风格类型】\n{style_options}\n\n【补充要求】\n{extra_requirement}\n\n请拆解成可入库的开头词模板，返回 JSON：{"template_name":"模板名","style":"从固定风格中选择一个适用风格类型","general_phrase":"保留句式骨架和剧情槽位的开头词内容","analysis":"拆解说明","slot_hint":"槽位/适配提示","tags":["标签1"],"linked_template_ids":[]}'
};

// 风格别名映射（对齐 Python normalize_opening_style 的 mapping）
const STYLE_ALIASES = [
  ['现代女主', '现代女主'], ['现代女频', '现代女主'], ['现代虐', '现代虐文'],
  ['现代甜', '现代甜文'], ['现代悬疑', '现代悬疑'], ['现代', '现代通用'],
  ['古风虐', '古风虐文'], ['古风甜', '古风甜文'], ['古风', '古风通用'],
  ['年代虐', '年代虐文'], ['年代甜', '年代甜文'], ['年代', '年代通用'],
  ['都市', '男频都市'], ['男频', '男频都市'], ['玄幻', '玄幻'],
  ['历史', '历史'], ['奇葩', '家庭奇葩'], ['家庭伤感', '家庭伤感'],
  ['家庭', '家庭奇葩'], ['职场', '职场打脸'], ['BGM', '现代通用'], ['爆款', '现代通用']
];

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

// 风格归一：精确命中 > 固定风格包含 > 别名映射 > 默认「现代通用」
function normalizeOpeningStyle(value, fixedStyles) {
  const fixed = Array.isArray(fixedStyles) && fixedStyles.length ? fixedStyles : STYLE_NAMES;
  const text = cleanCell(value);
  if (!text) return '';
  if (fixed.includes(text)) return text;
  for (const style of fixed) {
    if (style && text.includes(style)) return style;
  }
  for (const [key, target] of STYLE_ALIASES) {
    if (text.includes(key) && fixed.includes(target)) return target;
  }
  return fixed.includes('现代通用') ? '现代通用' : (fixed[0] || '');
}

// 开头词条目规范化：AI 返回的 general_phrase/template/content → text；style 归一到固定风格
function normalizeOpeningItem(item, index, fixedStyles) {
  const text = cleanCell(item.text || item.general_phrase || item.content || item.template || item['开头词内容']);
  const rawStyle = cleanCell(item.style || item['适用风格类型'] || item.category || item.hook_type || item['开头分类']);
  const tags = [];
  for (const value of normalizeItems(item.tags || item['标签'])) {
    const tag = cleanCell(value);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  for (const value of [item.hook_type, item.category]) {
    const tag = cleanCell(value);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return {
    id: cleanCell(item.id) || `opening_${String(index + 1).padStart(3, '0')}`,
    text,
    style: normalizeOpeningStyle(rawStyle, fixedStyles),
    tags,
    source: cleanCell(item.source) || 'website'
  };
}

// ===== 开头词 store =====
// systemDir：系统数据根目录；styles：固定风格列表（缺省用 routes/novel-fetch 的 STYLE_NAMES）
function createOpeningStore({ systemDir, styles } = {}) {
  if (typeof systemDir !== 'string' || !systemDir.trim()) throw new Error('systemDir is required');
  const resolvedSystemDir = path.resolve(systemDir);
  const fixedStyles = Array.isArray(styles) && styles.length ? styles : STYLE_NAMES;
  const openingPath = path.join(resolvedSystemDir, KNOWLEDGE_DIR_NAME, KNOWLEDGE_FILE_NAMES.opening_phrases);

  function readLibrary() {
    const result = readJsonOrMissing(openingPath);
    return result.found && isPlainObject(result.value)
      ? result.value
      : { source: 'website', updated_at: '', styles: [], items: [] };
  }

  function writeLibrary(data) {
    fs.mkdirSync(path.dirname(openingPath), { recursive: true });
    withJsonLock(path.join(path.dirname(openingPath), '.knowledge.lock'), () => {
      writeJsonAtomic(openingPath, data);
    });
  }

  // 调 AI 把爆款开头原文拆解为可入库的开头词条目（不自动落盘，由 save 单独保存）
  async function analyze(ai, settings, text) {
    const sourceText = String(text == null ? '' : text).trim();
    if (!sourceText) throw new Error('请先粘贴爆款开头原文');
    const chatFn = ai && typeof ai.chatCompletion === 'function' ? ai.chatCompletion : chatCompletion;
    const parseJson = ai && typeof ai.parseAiJsonContent === 'function' ? ai.parseAiJsonContent : parseAiJsonContent;
    const userPrompt = String(DEFAULT_ANALYZER.user_prompt_template)
      .replace('{source_text}', sourceText)
      .replace('{current_style}', '让 AI 根据固定风格类型自动选择')
      .replace('{style_options}', fixedStyles.join('、'))
      .replace('{extra_requirement}', '');
    const messages = [
      { role: 'system', content: DEFAULT_ANALYZER.system_prompt },
      { role: 'user', content: userPrompt }
    ];
    const response = await chatFn(settings, messages, { temperature: 0.2 });
    const content = (response && response.text) || '';
    let parsed = parseJson(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      parsed = { template_name: 'AI拆解开头词', general_phrase: content };
    }
    // 支持 AI 返回单个对象或 { items: [...] } 数组
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [parsed];
    const items = [];
    for (let i = 0; i < rawItems.length; i++) {
      if (!isPlainObject(rawItems[i])) continue;
      const item = normalizeOpeningItem(rawItems[i], i, fixedStyles);
      if (item.text) items.push(item);
    }
    if (!items.length) {
      items.push(normalizeOpeningItem({ template_name: 'AI拆解开头词', general_phrase: content }, 0, fixedStyles));
    }
    return { ok: true, items, raw: parsed };
  }

  // 保存/覆盖开头词条目到 opening_phrases.json
  function save(item) {
    if (!isPlainObject(item)) throw new Error('开头词条目格式无效');
    const data = readLibrary();
    const normalized = normalizeOpeningItem(item, data.items.length, fixedStyles);
    if (!normalized.text) throw new Error('开头词内容不能为空');
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
    data.styles = [...new Set(items.map(i => cleanCell(i.style)).filter(Boolean))];
    data.updated_at = isoLocalTime(new Date());
    writeLibrary(data);
    return { ok: true, item: normalized };
  }

  // 规范化：按 text 去重（保留首次）、丢弃空内容条目，按 style 归类并落盘
  function normalize() {
    const data = readLibrary();
    const seen = new Set();
    const items = [];
    let removed = 0;
    for (const raw of data.items) {
      if (!isPlainObject(raw)) {
        removed++;
        continue;
      }
      const normalized = normalizeOpeningItem(raw, items.length, fixedStyles);
      if (!normalized.text || seen.has(normalized.text)) {
        removed++;
        continue;
      }
      seen.add(normalized.text);
      items.push(normalized);
    }
    const grouped = {};
    for (const item of items) {
      const style = item.style || '未分类';
      if (!grouped[style]) grouped[style] = [];
      grouped[style].push(item);
    }
    data.items = items;
    data.styles = Object.keys(grouped);
    data.updated_at = isoLocalTime(new Date());
    writeLibrary(data);
    return { ok: true, removed, grouped };
  }

  return { analyze, save, normalize };
}

module.exports = {
  createOpeningStore,
  normalizeOpeningItem,
  normalizeOpeningStyle,
  DEFAULT_ANALYZER
};
