// 改文工作台：系统级配置存储
// 提供工作台配置的默认值，以及基于磁盘的读写 store（platforms / styles / ai-config / 主配置）。
// 落盘复用 ../system-store 的 readJsonOrMissing / writeJsonAtomic / withJsonLock；
// 平台表与风格表复用 routes/novel-fetch 的 PLATFORMS / STYLE_NAMES 常量。
const path = require('node:path');
const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('../system-store');
const { PLATFORMS, STYLE_NAMES } = require('../../routes/novel-fetch');

// 工作台主配置的完整默认值（配置键沿用 snake_case）
const DEFAULT_WORKSHOP_CONFIG = {
  workflow: { auto_classify_missing: true, auto_fetch_original: true, auto_rewrite_after_fetch: false },
  fetch: { endpoint: 'https://txt.121w.com/api.php', default_max_txt: 4000, timeout_seconds: 30, concurrency: 4, retries: 1 },
  ai: { base_url: '', api_key: '', model: '', timeout_seconds: 180, max_concurrency: 6, retry_times: 2,
        stream: false, json_mode: false, max_tokens: 1200, temperature: 0.45, top_p: 0.9,
        presence_penalty: 0, frequency_penalty: 0, enable_thinking: false, disable_thinking: false,
        force_serial_batch: false, extra_body_json: '' },
  ai_presets: [],
  ai_assignments: { classifier: '__current__', rewrite: '__current__', sensitive_fix: '__current__' },
  rewrite: { default_ai_count: 1, max_ai_count: 5, process_line_count: 5, anchor_line_count: 5,
             temperature: 0.45, strategy: 'instruction',
             method_sequence: ['high_imitation', 'opening_instruction', 'instruction'],
             default_template_id: 'rewrite_008', opening_phrase_mode: 'auto', high_imitation_mode: 'auto',
             prompt: '你是短视频小说正文改写师。请只根据原文、风格类型和男女频改写开头部分，保留故事事实、人物关系、时代背景和后续衔接。输出正文，不要解释。' },
  layout: { apply_to_original: true, apply_to_ai: true, apply_sensitive: true, apply_chapter_cleanup: true,
            apply_symbol_rules: true, apply_pair_fill: true, drop_empty_lines: true, trim_lines: true },
  sensitive_ai: { enabled: true, context_chars: 12, max_hits_per_task: 80, concurrency: 4, retries: 1,
                  temperature: 0.2, prompt: '你是内容合规改写助手。请只改写下面命中敏感词的小段内容。\n要求：保留原剧情意思、人物关系和情绪；不增加新剧情；去掉违规、擦边、色情、低俗表达。\n只返回改写后的小段，不要解释。\n\n任务ID：{book_id}\n命中词：{keyword}\n\n原片段：\n{snippet}' },
  parser: { default_parse_mode: 'smart', default_column_preset_id: 'sample_input', custom_column_order: '书籍ID,书名,推荐理由,男女频,标签,评级' }
};

// 判断是否为普通对象（排除数组）
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// 深合并：普通对象逐层合并，数组与原始值整体替换（后者覆盖前者）
function deepMerge(...objects) {
  const result = {};
  for (const source of objects) {
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      if (isPlainObject(value) && isPlainObject(result[key])) {
        result[key] = deepMerge(result[key], value);
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}

// 创建系统级工作台配置 store
// systemDir：系统数据根目录（例如 data/system），工作台配置目录 = systemDir/novel-fetch-workshop
function createWorkshopConfigStore({ systemDir } = {}) {
  if (typeof systemDir !== 'string' || !systemDir.trim()) throw new Error('systemDir is required');
  const resolvedSystemDir = path.resolve(systemDir);
  const configDir = path.join(resolvedSystemDir, 'novel-fetch-workshop');

  const appPath = () => path.join(configDir, 'app.json');
  const aiConfigPath = () => path.join(configDir, 'ai-config.json');
  const platformsPath = () => path.join(configDir, 'platforms.json');
  const stylesPath = () => path.join(configDir, 'styles.json');

  // 读取 ai-config.json，缺失或字段不全时用默认值深合并补齐
  function readAiConfigFromDisk() {
    const aiDefaults = {
      ai: DEFAULT_WORKSHOP_CONFIG.ai,
      ai_presets: DEFAULT_WORKSHOP_CONFIG.ai_presets,
      ai_assignments: DEFAULT_WORKSHOP_CONFIG.ai_assignments
    };
    const result = readJsonOrMissing(aiConfigPath());
    if (!result.found) return deepMerge({}, aiDefaults);
    return deepMerge(aiDefaults, result.value);
  }

  // 主配置：默认值 + app.json + ai-config.json 三层深合并（ai 相关以 ai-config.json 为准）
  function getConfig() {
    const result = readJsonOrMissing(appPath());
    const saved = result.found && isPlainObject(result.value) ? result.value : {};
    return deepMerge(DEFAULT_WORKSHOP_CONFIG, saved, readAiConfigFromDisk());
  }

  // 浅层补丁深合并后原子写盘 app.json，返回保存后的完整配置
  function saveConfig(patch = {}) {
    const merged = deepMerge(getConfig(), patch);
    withJsonLock(path.join(configDir, '.config.lock'), () => {
      writeJsonAtomic(appPath(), merged);
    });
    return merged;
  }

  // 平台表：缺失时以 PLATFORMS 常量种子化并写盘；读不到则回退常量
  function getPlatforms() {
    const result = readJsonOrMissing(platformsPath());
    if (result.found && Array.isArray(result.value)) return result.value;
    withJsonLock(path.join(configDir, '.config.lock'), () => {
      writeJsonAtomic(platformsPath(), PLATFORMS);
    });
    return PLATFORMS;
  }

  // 风格表：缺失时以 STYLE_NAMES 常量种子化并写盘；读不到则回退常量
  function getStyles() {
    const result = readJsonOrMissing(stylesPath());
    if (result.found && Array.isArray(result.value)) return result.value;
    withJsonLock(path.join(configDir, '.config.lock'), () => {
      writeJsonAtomic(stylesPath(), STYLE_NAMES);
    });
    return STYLE_NAMES;
  }

  // 读取 ai 相关配置 { ai, ai_presets, ai_assignments }
  function getAiConfig() {
    return readAiConfigFromDisk();
  }

  // 只保存 ai / ai_presets / ai_assignments 三个键到 ai-config.json
  function saveAiConfig(patch = {}) {
    const current = readAiConfigFromDisk();
    const aiPatch = {};
    if (Object.hasOwn(patch, 'ai')) aiPatch.ai = patch.ai;
    if (Object.hasOwn(patch, 'ai_presets')) aiPatch.ai_presets = patch.ai_presets;
    if (Object.hasOwn(patch, 'ai_assignments')) aiPatch.ai_assignments = patch.ai_assignments;
    const merged = deepMerge(current, aiPatch);
    withJsonLock(path.join(configDir, '.config.lock'), () => {
      writeJsonAtomic(aiConfigPath(), merged);
    });
    return merged;
  }

  return { getConfig, saveConfig, getPlatforms, getStyles, getAiConfig, saveAiConfig };
}

// 按 systemDir 缓存单例
const storeCache = new Map();
function getWorkshopConfigStore(systemDir) {
  const key = path.resolve(systemDir);
  if (!storeCache.has(key)) storeCache.set(key, createWorkshopConfigStore({ systemDir }));
  return storeCache.get(key);
}

module.exports = { DEFAULT_WORKSHOP_CONFIG, createWorkshopConfigStore, getWorkshopConfigStore };
