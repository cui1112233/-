// 改文工作台：改文引擎（行切分、三方案消息构造、出文轮换、AI 返回解析、回拼、多版本生成）
// 分层设计：纯函数（methodForAiIndex / splitLines / build*Messages / extractAiChangedText /
// mergeChangedBlockWithOriginal）+ 编排（generateAiVersion 生成单个版本、generateAiVersions 多版本）。
// 依赖：./ai（resolveAiSettings / chatCompletion / parseAiJsonContent）、
//       ./config（getWorkshopConfigStore：路由侧（Task 7）用它构建 configStore 后注入，本模块不做默认构建）、
//       ./tasks（normalizeNewlines / dropEmptyLines；运行期 tasks 对象由 createWorkshopTasks 注入）。
// 一期无知识库文件（opening_phrases / high_imitation / rewrite_templates 均为空），三方案都走兜底文案。
const fs = require('node:fs');
const path = require('node:path');
const { resolveAiSettings, chatCompletion, parseAiJsonContent } = require('./ai');
const { getWorkshopConfigStore } = require('./config');
const { normalizeNewlines, dropEmptyLines } = require('./tasks');

const REWRITE_METHODS = ['high_imitation', 'opening_instruction', 'instruction'];

// ===== 出文轮换 =====

// 方案名别名归一：high|mimic|高仿 → high_imitation；opening|开头词 → opening_instruction；其余 → instruction
function normalizeMethodAlias(method) {
  const m = String(method == null ? '' : method).trim();
  const lower = m.toLowerCase();
  if (lower === 'high_imitation' || lower === 'high' || lower.includes('mimic') || lower.includes('高仿')) return 'high_imitation';
  if (lower === 'opening_instruction' || lower === 'opening' || lower.includes('开头词') || lower.includes('opening')) return 'opening_instruction';
  return 'instruction';
}

// 按 AI 序号轮换方案：sequence[(aiIndex-1) % sequence.length]
// 默认 ['high_imitation','opening_instruction','instruction'] → ai1=high_imitation, ai2=opening_instruction, ai3=instruction, ai4=high_imitation
function methodForAiIndex(sequence, aiIndex) {
  const seq = Array.isArray(sequence) && sequence.length ? sequence : REWRITE_METHODS;
  const index = (Number(aiIndex) - 1) % seq.length;
  const raw = seq[index < 0 ? index + seq.length : index];
  return normalizeMethodAlias(raw);
}

// ===== 行切分 =====

// 按 \n 拆行并过滤空行；前 processLineCount 行为待处理块，其后 anchorLineCount 行为只读锚点，fullText 为完整原文
function splitLines(text, { processLineCount, anchorLineCount } = {}) {
  const lines = normalizeNewlines(text).split('\n').filter(line => line.trim() !== '');
  const processCount = Math.max(0, Math.floor(Number(processLineCount) || 0));
  const anchorCount = Math.max(0, Math.floor(Number(anchorLineCount) || 0));
  const targetLines = lines.slice(0, processCount);
  const anchorLines = lines.slice(processCount, processCount + anchorCount);
  const fullText = lines.join('\n');
  return { lines, targetLines, anchorLines, fullText };
}

// ===== 三方案消息构造（一期兜底）=====

// 指令/开头词方案共用的 extra_instruction（一期无模板与开头词块，与 instruction 内容一致）
function buildRewriteExtraInstruction({ task, config, aiIndex }) {
  const prompt = (config && config.rewrite && config.rewrite.prompt) || '';
  return [
    `本次生成第 ${aiIndex} 个AI文案。`,
    `风格类型：${(task && task.style) || ''}`,
    `男女频：${(task && task.gender) || ''}`,
    '',
    '【当前改文提示词】',
    prompt
  ].join('\n');
}

// 指令 / 开头词方案：system 直接用 config.rewrite.prompt（一期无模板库），user 用内置 JSON 兜底
function buildRewriteMessages({ strategy, config, task, targetLines, anchorLines, fullText, aiIndex }) {
  const prompt = (config && config.rewrite && config.rewrite.prompt) || '';
  const target = Array.isArray(targetLines) ? targetLines : [];
  const anchor = Array.isArray(anchorLines) ? anchorLines : [];
  const system = { role: 'system', content: prompt };
  const user = {
    role: 'user',
    content: JSON.stringify({
      book_id: (task && task.bookId) || '',
      book_name: (task && task.bookName) || '',
      style: (task && task.style) || '',
      gender: (task && task.gender) || '',
      full_text: fullText || '',
      target_lines_text: target.join('\n'),
      anchor_lines_text: anchor.join('\n'),
      line_count: target.length,
      extra_instruction: buildRewriteExtraInstruction({ task, config, aiIndex }),
      output: '只输出改写后的正文，不要解释。'
    })
  };
  return [system, user];
}

// 高仿方案 system 兜底提示词（一期高仿库为空，逐字使用）
const HIGH_IMITATION_SYSTEM = `请先拆解参考文案的开口方式、节奏和冲突表达，再落回目标原文真实冲突。
只能仿写前段，不能照搬参考剧情，不能新增重大设定。`;

// 高仿方案：一期无匹配参考，reference 用兜底文案；user 用内置 JSON 兜底
function buildHighImitationMessages({ config, task, targetLines, anchorLines, fullText, aiIndex }) {
  const target = Array.isArray(targetLines) ? targetLines : [];
  const anchor = Array.isArray(anchorLines) ? anchorLines : [];
  const system = { role: 'system', content: HIGH_IMITATION_SYSTEM };
  const user = {
    role: 'user',
    content: JSON.stringify({
      book_id: (task && task.bookId) || '',
      book_name: (task && task.bookName) || '',
      style: (task && task.style) || '',
      gender: (task && task.gender) || '',
      version_index: aiIndex,
      reference: '当前高仿文章库没有匹配参考文案。请只按高仿处理指令拆原文前段节奏，不要新增剧情。',
      full_text: fullText || '',
      target_lines_text: target.join('\n'),
      anchor_lines_text: anchor.join('\n'),
      line_count: target.length,
      task: '只高仿改写待处理块。参考文案只借开口方式、句式节奏、冲突结构，不照搬参考剧情。只读锚点不能复制，后文由本地系统拼回。',
      return_format: {
        id: (task && task.bookId) || '',
        changed_lines: [{ line_no: 1, text: '完整改写后的待处理块，可以包含换行' }]
      }
    })
  };
  return [system, user];
}

// ===== AI 返回解析 =====

// 从 AI 返回中提取改写文本：
// 1) 对象含 changed_lines 数组 → 逐项取 text join（responseMode='changed_lines'）
// 2) 对象取 changed_text/text/content/result/output 首个非空字符串（responseMode='key'）
// 3) 数组 → 逐项（对象取 text 或字符串）join（responseMode='list'）
// 4) JSON 失败或取不到 → 整段当纯文本（responseMode='plain'）
function extractAiChangedText(text) {
  const parsed = parseAiJsonContent(text);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (Array.isArray(parsed.changed_lines)) {
      const texts = parsed.changed_lines
        .map(item => (item && typeof item === 'object') ? item.text : item)
        .filter(value => typeof value === 'string' && value.trim() !== '');
      if (texts.length) return { text: texts.join('\n'), responseMode: 'changed_lines' };
    }
    for (const key of ['changed_text', 'text', 'content', 'result', 'output']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim() !== '') return { text: value, responseMode: 'key' };
    }
  } else if (Array.isArray(parsed)) {
    const texts = parsed
      .map(item => (item && typeof item === 'object') ? item.text : item)
      .filter(value => typeof value === 'string' && value.trim() !== '');
    if (texts.length) return { text: texts.join('\n'), responseMode: 'list' };
  }
  return { text: String(text == null ? '' : text), responseMode: 'plain' };
}

// ===== 回拼 =====

// 删去原文前 processLineCount 行，替换为清洗后的改写块（changedBlock 可为字符串或行数组）
function mergeChangedBlockWithOriginal(originalLines, changedBlock, { processLineCount } = {}) {
  const source = Array.isArray(changedBlock) ? changedBlock.join('\n') : changedBlock;
  const deleteCount = Math.min(Math.max(0, Math.floor(Number(processLineCount) || 0)), originalLines.length);
  const cleaned = dropEmptyLines(normalizeNewlines(source));
  const changedLines = cleaned === '' ? [] : cleaned.split('\n');
  const merged = changedLines.concat(originalLines.slice(deleteCount));
  return normalizeNewlines(merged.join('\n'));
}

// ===== 编排：生成单个版本 =====

// 从错误对象提取可读信息
function describeError(error) {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    if (typeof error.message === 'string' && error.message) return error.message;
    if (typeof error.error === 'string' && error.error) return error.error;
    try { return JSON.stringify(error); } catch (_) { return String(error); }
  }
  return String(error);
}

// 生成单个版本 aiN → { status, versionText, error }
// 前置：原文未就绪 → waiting_original；AI 配置未完成 → waiting_ai_config。
// 流程：切分 → 按 method_sequence 选方案 → 构造消息 → chatCompletion → 解析回拼 → 写 ai/ai{n}/{bookId}.txt
//       → 更新 meta（aiStatus / aiGeneratedCount / rewriteKnowledge）→ appendLog。
// ai 参数可注入 mock（默认用 ./ai），供测试与路由复用。
async function generateAiVersion({ configStore, tasks, username, task, aiIndex, count, ai } = {}) {
  const aiModule = ai || { resolveAiSettings, chatCompletion };
  const bookId = (task && task.bookId) || '';

  // 前置：原文未就绪
  const originalText = tasks.readOriginal(username, bookId);
  if (!task || task.originalStatus !== 'done' || !originalText) {
    await tasks.updateTaskMeta(username, bookId, { aiStatus: 'waiting_original' });
    return { status: 'waiting_original', versionText: '', error: '' };
  }

  // 前置：AI 配置未完成
  const settings = aiModule.resolveAiSettings(configStore, 'rewrite');
  if (!settings.baseUrl || !settings.model) {
    await tasks.updateTaskMeta(username, bookId, { aiStatus: 'waiting_ai_config' });
    return { status: 'waiting_ai_config', versionText: '', error: '' };
  }

  const config = configStore.getConfig();
  const rewriteConfig = (config && config.rewrite) || {};
  const strategy = methodForAiIndex(rewriteConfig.method_sequence, aiIndex);
  const { lines, targetLines, anchorLines, fullText } = splitLines(originalText, {
    processLineCount: rewriteConfig.process_line_count,
    anchorLineCount: rewriteConfig.anchor_line_count
  });

  const messages = strategy === 'high_imitation'
    ? buildHighImitationMessages({ config, task, targetLines, anchorLines, fullText, aiIndex })
    : buildRewriteMessages({ strategy, config, task, targetLines, anchorLines, fullText, aiIndex });

  let response;
  try {
    response = await aiModule.chatCompletion(settings, messages, { temperature: rewriteConfig.temperature });
  } catch (error) {
    // 失败：累计状态（此前已有成功/部分 → partial，否则 failed）
    const message = describeError(error) || 'AI 调用失败';
    const current = tasks.getTask(username, bookId);
    const prevStatus = (current && current.meta && current.meta.aiStatus) || '';
    const prevCount = (current && current.meta && Number(current.meta.aiGeneratedCount)) || 0;
    const aiStatus = (prevStatus === 'done' || prevStatus === 'partial') ? 'partial' : 'failed';
    await tasks.updateTaskMeta(username, bookId, {
      aiStatus,
      aiGeneratedCount: Math.max(prevCount, aiIndex),
      aiError: message
    });
    tasks.appendLog(username, bookId, 'ai_generate_failed', { bookId, aiIndex, strategy, error: message });
    return { status: 'failed', versionText: '', error: message };
  }

  const { text: changedText, responseMode } = extractAiChangedText((response && response.text) || '');

  // 空值判定：AI 返回空/空白文本或提取失败 → 本次生成失败。
  // 若继续回拼会把开头 process_line_count 行整体删掉却仍标 done，属静默损坏，必须在此拦截。
  if (!changedText || changedText.trim() === '') {
    const message = 'AI改文返回为空';
    const current = tasks.getTask(username, bookId);
    const prevStatus = (current && current.meta && current.meta.aiStatus) || '';
    const prevCount = (current && current.meta && Number(current.meta.aiGeneratedCount)) || 0;
    const aiStatus = (prevStatus === 'done' || prevStatus === 'partial') ? 'partial' : 'failed';
    await tasks.updateTaskMeta(username, bookId, {
      aiStatus,
      aiGeneratedCount: Math.max(prevCount, aiIndex),
      aiError: message
    });
    tasks.appendLog(username, bookId, 'ai_generate_failed', { bookId, aiIndex, strategy, responseMode, error: message });
    return { status: 'failed', versionText: '', error: message };
  }

  const merged = mergeChangedBlockWithOriginal(lines, changedText, { processLineCount: rewriteConfig.process_line_count });

  // 写版本文件 ai/ai{n}/{bookId}.txt
  const aiPath = tasks.pathForAiVersion(username, bookId, aiIndex);
  fs.mkdirSync(path.dirname(aiPath), { recursive: true });
  fs.writeFileSync(aiPath, merged, 'utf8');

  // 更新 meta：本次成功且此前无失败 → done，否则（此前有失败/部分）→ partial
  const current = tasks.getTask(username, bookId);
  const prevStatus = (current && current.meta && current.meta.aiStatus) || '';
  const prevCount = (current && current.meta && Number(current.meta.aiGeneratedCount)) || 0;
  const deleteCount = Math.min(Math.max(0, Math.floor(Number(rewriteConfig.process_line_count) || 0)), lines.length);
  const cleanedChanged = dropEmptyLines(normalizeNewlines(changedText));
  const changedLineCount = cleanedChanged === '' ? 0 : cleanedChanged.split('\n').length;
  const finalLineCount = merged === '' ? 0 : merged.split('\n').length;
  const aiStatus = (prevStatus === 'failed' || prevStatus === 'partial') ? 'partial' : 'done';
  await tasks.updateTaskMeta(username, bookId, {
    aiStatus,
    aiGeneratedCount: Math.max(prevCount, aiIndex),
    aiError: '', // 清空旧的失败记录
    rewriteKnowledge: {
      strategy,
      aiIndex,
      responseMode,
      patch: { deleteLineCount: deleteCount, changedLineCount, finalLineCount }
    }
  });
  tasks.appendLog(username, bookId, 'ai_generated', { bookId, aiIndex, strategy, responseMode });

  return { status: 'done', versionText: merged, error: '' };
}

// ===== 编排：多版本生成 =====

// 循环 1..count 调 generateAiVersion，聚合状态：
// done（全成功）/ partial（部分）/ failed（全失败）/ waiting_original / waiting_ai_config（任务级前置，提前终止）
async function generateAiVersions({ configStore, tasks, username, task, count, ai } = {}) {
  const rawCount = Number(count);
  const n = Number.isFinite(rawCount) ? Math.floor(rawCount) : 1;
  const generated = [];
  if (n <= 0) return { status: 'done', generated, error: '' };

  let successCount = 0;
  let failCount = 0;
  let lastError = '';
  for (let aiIndex = 1; aiIndex <= n; aiIndex++) {
    const r = await generateAiVersion({ configStore, tasks, username, task, aiIndex, count: n, ai });
    generated.push(r);
    if (r.status === 'done') {
      successCount++;
    } else if (r.status === 'failed') {
      failCount++;
      if (r.error) lastError = r.error;
    } else {
      // waiting_original / waiting_ai_config：任务级前置条件，后续版本结果相同，提前终止
      return { status: r.status, generated, error: lastError };
    }
  }

  let status;
  if (successCount > 0 && failCount === 0) status = 'done';
  else if (successCount === 0) status = 'failed';
  else status = 'partial';
  return { status, generated, error: lastError };
}

module.exports = {
  REWRITE_METHODS,
  methodForAiIndex,
  splitLines,
  buildRewriteMessages,
  buildHighImitationMessages,
  buildRewriteExtraInstruction,
  extractAiChangedText,
  mergeChangedBlockWithOriginal,
  generateAiVersion,
  generateAiVersions,
  getWorkshopConfigStore
};
