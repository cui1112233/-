// 改文工作台：男女频/风格 AI 分类
// 对清单里缺 style 或缺 gender 的任务做批量 AI 判断并回填。
// 分层设计：buildClassifyMessages 构造消息、parseClassifyResult 解析回填（纯函数）、
// classifyMissingRows 组织 AI 调用与重试（ai 可注入 mock，默认用 ./ai）。
const { resolveAiSettings, chatCompletion, parseAiJsonContent } = require('./ai');
const { normalizeGender, normalizeStyle } = require('./parse');

// 系统提示词（逐字使用）
const SYSTEM_PROMPT = `你是小说批量系统的分类助手。只判断缺失的风格类型和男女频。
风格类型必须从固定风格类型里选择一个，男女频只能返回男频或女频。
如果输入已有 existing_gender 或 existing_style，不要改写已有值。只输出 JSON。`;

// 从上游错误对象中提取可读信息
function describeAiError(error) {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    if (typeof error.message === 'string' && error.message) return error.message;
    if (typeof error.error === 'string' && error.error) return error.error;
    try { return JSON.stringify(error); } catch (_) { return String(error); }
  }
  return String(error);
}

// 构造分类消息 → [systemMessage, userMessage]
function buildClassifyMessages({ fixedStyles, items }) {
  const userContent = JSON.stringify({
    fixed_styles: Array.isArray(fixedStyles) ? fixedStyles : [],
    items,
    required_format: {
      results: [
        { row_number: '数字', book_id: '书籍ID', style: '固定风格类型之一', gender: '男频或女频', confidence: '0.00-1.00', reason: '一句话依据' }
      ]
    }
  });
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent }
  ];
}

// 解析 AI 返回并回填任务（原地修改，返回同一数组）
function parseClassifyResult(text, tasks, fixedStyles) {
  const styles = Array.isArray(fixedStyles) ? fixedStyles : [];
  const parsed = parseAiJsonContent(text);

  // 防御：上游返回 {"error": {...}} 时按失败处理（Task 3 minor #2）
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'error' in parsed) {
    const detail = describeAiError(parsed.error) || 'AI 返回了错误';
    const errMsg = `AI分类失败：${detail.slice(0, 100)}`;
    for (const task of tasks) {
      task.classifyStatus = 'failed';
      task.classifyError = errMsg;
    }
    return { tasks };
  }

  const results = parsed && Array.isArray(parsed.results) ? parsed.results : [];

  // 索引：row_number 对应任务在 tasks 数组中的位置（1 起）；另建 book_id 索引
  const byRowNumber = new Map();
  const byBookId = new Map();
  tasks.forEach((task, index) => {
    byRowNumber.set(index + 1, task);
    if (task.bookId) byBookId.set(String(task.bookId), task);
  });

  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const rowNumber = Number(result.row_number);
    const task = (Number.isFinite(rowNumber) && byRowNumber.get(rowNumber))
      || (result.book_id && byBookId.get(String(result.book_id)));
    if (!task) continue; // 无匹配任务，跳过

    // 风格必须落回固定列表，否则置 failed 并跳过回填
    const styleValue = result.style == null ? '' : String(result.style);
    const style = normalizeStyle(styleValue, styles);
    if (!style) {
      task.classifyStatus = 'failed';
      task.classifyError = `AI返回风格不在固定列表：${styleValue}`;
      continue;
    }
    // 男女频规范化，空则失败记录
    const genderValue = result.gender == null ? '' : String(result.gender);
    const gender = normalizeGender(genderValue);
    if (!gender) {
      task.classifyStatus = 'failed';
      task.classifyError = `AI返回男女频无效：${genderValue}`;
      continue;
    }

    task.gender = gender;
    task.genderSource = 'ai';
    task.style = style;
    task.styleSource = 'ai';
    task.classifyStatus = 'classified';
    const confidence = Number(result.confidence);
    task.classifyConfidence = Number.isFinite(confidence) ? confidence : '';
    task.classifyReason = result.reason == null ? '' : String(result.reason);
  }
  return { tasks };
}

// 对缺 style 或缺 gender 的任务做批量 AI 分类并回填
// → { tasks, errors }，errors 为字符串数组（汇总失败原因）
async function classifyMissingRows({ configStore, ai, tasks } = {}) {
  const aiModule = ai || require('./ai');
  const errors = [];

  // style 与 gender 都齐全的任务标记 input_ready（已有状态不覆盖）
  for (const task of tasks) {
    if (task.style && task.gender && !task.classifyStatus) task.classifyStatus = 'input_ready';
  }

  // 只处理缺 style 或缺 gender 的任务
  const candidates = tasks.filter(task => !task.style || !task.gender);
  if (!candidates.length) return { tasks, errors };

  const settings = aiModule.resolveAiSettings(configStore, 'classifier');
  // 未配置 AI（无 baseUrl/model）→ 待分类任务 waiting_ai_config
  if (!settings.baseUrl || !settings.model) {
    for (const task of candidates) {
      task.classifyStatus = 'waiting_ai_config';
      task.classifyError = 'AI 分类配置为空，已保留任务，配置后可重新判断';
    }
    return { tasks, errors };
  }

  const fixedStyles = configStore.getStyles();

  // 构造 items：row_number 为任务在 tasks 数组中的位置（1 起），供解析回填定位
  const items = candidates.map(task => {
    const index = tasks.indexOf(task);
    return {
      row_number: index + 1,
      book_id: task.bookId || '',
      book_name: task.bookName || '',
      existing_gender: task.gender || '',
      existing_style: task.style || '',
      tags: task.tags || '',
      reason: task.reason || '',
      rating: task.rating || ''
    };
  });
  const messages = buildClassifyMessages({ fixedStyles, items });
  // 每次分类调用记录模型
  for (const task of candidates) task.classifierModel = settings.model;

  const retryTimes = Number.isFinite(Number(settings.retry_times))
    ? Math.max(0, Math.floor(Number(settings.retry_times)))
    : 2;

  // 重试：调用失败（throw 或 error 键）时按 retry_times（默认 2）次重试，
  // 间隔 1.2 * attempt 秒（attempt 从 1 开始）
  let lastError = '';
  let text = '';
  let success = false;
  for (let attempt = 0; attempt <= retryTimes; attempt++) {
    try {
      const response = await aiModule.chatCompletion(settings, messages, { temperature: 0 });
      text = (response && response.text) || '';
      const parsed = parseAiJsonContent(text);
      // 防御上游 error 键：视为失败进入重试
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'error' in parsed) {
        lastError = describeAiError(parsed.error) || 'AI 返回了错误';
        throw new Error(lastError);
      }
      success = true;
      break;
    } catch (err) {
      lastError = (err && err.message) ? String(err.message) : String(err);
      if (attempt < retryTimes) {
        const delayMs = Math.round(1.2 * (attempt + 1) * 1000);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  if (success) {
    parseClassifyResult(text, tasks, fixedStyles);

    // 收尾检查：AI 返回成功但内容不可用（parseAiJsonContent 解析为 null / results 未覆盖
    // 某些候选任务）时，这些候选任务仍缺 gender 或缺 style，不能让它们保持未处理状态
    // （否则调用方无法区分"未处理"与"已失败"），统一置 failed 并记录错误。
    const FINAL_FALLBACK_ERROR = 'AI分类结果未覆盖或无法解析';
    for (const task of candidates) {
      const stillMissing = !task.style || !task.gender;
      const statusUnset = task.classifyStatus !== 'classified'
        && task.classifyStatus !== 'failed'
        && task.classifyStatus !== 'waiting_ai_config';
      if (stillMissing && statusUnset) {
        task.classifyStatus = 'failed';
        task.classifyError = FINAL_FALLBACK_ERROR;
      }
    }
  } else {
    // 全部失败 → 该批任务置 failed
    const errMsg = `AI分类失败：${lastError.slice(0, 100)}`;
    for (const task of candidates) {
      task.classifyStatus = 'failed';
      task.classifyError = errMsg;
    }
    errors.push(errMsg);
  }

  // 汇总单任务失败原因
  for (const task of candidates) {
    if (task.classifyStatus === 'failed' && task.classifyError && !errors.includes(task.classifyError)) {
      errors.push(task.classifyError);
    }
  }
  return { tasks, errors };
}

module.exports = { buildClassifyMessages, parseClassifyResult, classifyMissingRows };
