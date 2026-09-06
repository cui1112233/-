'use strict';

const VERSION = 'v78.3.0.31';
const GROUPS = ['must_cover', 'rhythm', 'row_guidance', 'scene_progression'];
const PREFIX = { must_cover: 'M', rhythm: 'R', row_guidance: 'G', scene_progression: 'S' };
const activeUsers = new Set();

function text(value, limit = 0) {
  const result = String(value == null ? '' : value).trim();
  return limit ? result.slice(0, limit) : result;
}
function list(value) { return Array.isArray(value) ? value : []; }
function number(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function sourceRows(novelText) {
  return text(novelText).split(/\r?\n/).map(text).filter(Boolean).map((source_text, index) => ({ source_index: index + 1, source_text, guidance: '' }));
}

function constraintItems(contract = {}) {
  return GROUPS.flatMap(group => list(contract[group]).map(item => ({ ...item, group })));
}

function itemIndices(item, rowCount) {
  if (item && item.applies_to_all_rows === true) return Array.from({ length: Math.max(1, rowCount) }, (_, i) => i + 1);
  const out = [];
  list(item && item.source_indices).forEach(value => {
    const idx = Number(value);
    if (Number.isInteger(idx) && idx >= 1 && idx <= Math.max(1, rowCount) && !out.includes(idx)) out.push(idx);
  });
  return out;
}

function validateConstraintContract(parsed, rowCount) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('导演要求契约顶层必须是JSON对象。');
  const clean = Object.fromEntries(GROUPS.map(group => [group, []]));
  const seen = new Set();
  for (const group of GROUPS) {
    const rawItems = parsed[group] == null ? [] : parsed[group];
    if (!Array.isArray(rawItems)) throw new Error(`导演要求契约.${group}必须是数组。`);
    rawItems.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`导演要求契约.${group}第${index + 1}项必须是对象。`);
      const id = text(raw.id, 40) || `${PREFIX[group]}${index + 1}`;
      if (seen.has(id)) throw new Error(`导演要求契约ID重复：${id}。`);
      seen.add(id);
      const requirement = text(raw.requirement, 1600);
      const passCondition = text(raw.pass_condition, 2000);
      if (!requirement || !passCondition) throw new Error(`导演要求契约${id}缺少requirement或pass_condition。`);
      if (typeof raw.applies_to_all_rows !== 'boolean') throw new Error(`导演要求契约${id}.applies_to_all_rows必须是JSON布尔值。`);
      const indices = [];
      list(raw.source_indices).forEach(value => {
        const idx = Number(value);
        if (!Number.isInteger(idx)) throw new Error(`导演要求契约${id}.source_indices存在无效行号。`);
        if (idx < 1 || idx > Math.max(1, rowCount)) throw new Error(`导演要求契约${id}引用越界原文行：${idx}。`);
        if (!indices.includes(idx)) indices.push(idx);
      });
      if (!raw.applies_to_all_rows && !indices.length) throw new Error(`导演要求契约${id}必须指定source_indices，或applies_to_all_rows=true。`);
      clean[group].push({ id, requirement, source_indices: indices, applies_to_all_rows: raw.applies_to_all_rows, pass_condition: passCondition });
    });
  }
  return clean;
}

function validateConstraintAudit(parsed, contract, rowCount) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('导演要求语义验收顶层必须是JSON对象。');
  const expected = new Map(constraintItems(contract).map(item => [text(item.id), item]));
  const clean = Object.fromEntries(GROUPS.map(group => [group, []]));
  const seen = new Set();
  for (const group of GROUPS) {
    const rawItems = parsed[group];
    if (!Array.isArray(rawItems)) throw new Error(`导演要求语义验收.${group}必须是数组。`);
    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`导演要求语义验收.${group}存在非对象项。`);
      const id = text(raw.id, 40);
      if (!id || !expected.has(id)) throw new Error(`导演要求语义验收出现未知ID：${id || '<empty>'}。`);
      if (seen.has(id)) throw new Error(`导演要求语义验收ID重复：${id}。`);
      seen.add(id);
      if (typeof raw.passed !== 'boolean') throw new Error(`导演要求语义验收${id}.passed必须是JSON布尔值。`);
      const evidence = list(raw.evidence).map(item => {
        const idx = Number(item && item.source_index);
        const quote = text(item && item.quote, 800);
        return Number.isInteger(idx) && idx >= 1 && idx <= Math.max(1, rowCount) && quote ? { source_index: idx, quote } : null;
      }).filter(Boolean);
      let failed = list(raw.failed_source_indices).map(Number).filter(idx => Number.isInteger(idx) && idx >= 1 && idx <= Math.max(1, rowCount));
      failed = [...new Set(failed)];
      if (!raw.passed && !failed.length) failed = itemIndices(expected.get(id), rowCount);
      clean[group].push({ id, passed: raw.passed, evidence, missing: text(raw.missing, 1600), failed_source_indices: failed });
    }
  }
  const missing = [...expected.keys()].filter(id => !seen.has(id));
  if (missing.length) throw new Error(`导演要求语义验收漏掉合同项：${missing.join(',')}。`);
  clean.overall_passed = GROUPS.every(group => clean[group].every(item => item.passed));
  return clean;
}

function failedSourceIndices(contract, audit, rowCount) {
  const byId = new Map(constraintItems(contract).map(item => [text(item.id), item]));
  const failed = new Set();
  GROUPS.forEach(group => list(audit && audit[group]).forEach(item => {
    if (item && item.passed === true) return;
    let indices = list(item && item.failed_source_indices).map(Number).filter(idx => Number.isInteger(idx) && idx >= 1 && idx <= rowCount);
    if (!indices.length && byId.has(text(item && item.id))) indices = itemIndices(byId.get(text(item.id)), rowCount);
    indices.forEach(idx => failed.add(idx));
  }));
  return [...failed].sort((a, b) => a - b);
}

function contractSystemPrompt() {
  return `你是“Outline V3 R8.4 通用导演要求契约编译器”。你的工作不是写分镜，而是把用户自由输入的导演要求与原文语义编译成可验收的JSON语义合同。\n【核心原则】\n1. 只返回JSON对象，顶层固定为 must_cover、rhythm、row_guidance、scene_progression 四个数组。\n2. 任何非空的必须拍细节、镜头节奏与推进要求、单卡补充意见都必须按语义拆解，不得依赖关键词逐字命中，不把示例写死成固定规则。\n3. 每项固定字段 id、requirement、source_indices、applies_to_all_rows、pass_condition。\n4. must_cover 必须在画面实际可见。\n5. rhythm 验收信息先后、切镜、停顿、反应与节奏推进。\n6. row_guidance 只约束对应原文行。\n7. scene_progression 表达真实地点/时间/事件空间迁移；需要A→B就明确推进，不需要换场就不得强行换场。\n8. 场景推进不替AI固定镜头语言，不新增原文不存在的关键地点、身份、证据或重大事件。\n9. pass_condition必须是语义可判断的完成条件，不是关键词检查。`;
}

function auditSystemPrompt() {
  return `你是“Outline V3 R8.4 导演要求语义验收器”。只做语义验收，不重写分镜。\n1. 只返回JSON对象，顶层固定 must_cover、rhythm、row_guidance、scene_progression、overall_passed。\n2. 对director_constraint_contract每个id逐项验收，一项不漏；只能依据generated_rows真实画面、动作、场景、节奏和微镜头判断，不能靠关键词相似判通过。\n3. 每项返回id、passed、evidence、missing、failed_source_indices。\n4. must_cover只有audio/旁白提到不算通过。\n5. rhythm检查信息先后、动作推进、切镜/停顿/反应是否真实落实。\n6. scene_progression检查真实空间/时间/事件推进。\n7. row_guidance不能拿别行证据代替。\n8. overall_passed仅当所有合同项通过才为true。`;
}

function repairSystemPrompt(generationRules) {
  return `你是“Outline V3 R8.4 导演要求定向修复器”。上一轮分镜主体已经成立，只修语义验收失败的原文行，禁止重写其它正确行。\n【用户完整AI指令】\n${text(generationRules, 30000)}\n【硬规则】\n1. 只返回JSON对象 {"outline_shots":[...]}，只返回target_source_indices指定行。\n2. source_index/source_basis保持原映射；每个目标行总duration必须与existing_shots完全一致。\n3. 原文事实、人物身份、已有正确剧情、音轨文本不得擅改，只修failed_constraints。\n4. 场景推进失败时必须真实进入正确空间，不只写“转场”。\n5. must_cover必须真实可见；rhythm必须靠镜头先后、动作切点、停顿/反应落实。\n6. 非目标行禁止返回。`;
}

function outlineSystemPrompt(base, contract) {
  return [
    text(base),
    '每个非空原文行至少有一条分镜，source_index从1开始对应原文非空行，source_basis必须引用对应原文。只返回合法JSON，不要Markdown。',
    '【R8.4 通用导演要求语义合同】请求中的director_constraint_contract是用户人工要求与场景推进的权威语义合同。必须逐项落实到对应source_index的真实画面/节奏/场景中；不得用关键词复述代替实际拍出，不得把本行要求污染到无关行。',
    `director_constraint_contract=${JSON.stringify(contract)}`,
  ].filter(Boolean).join('\n');
}

function parseJsonContent(raw) {
  let value = text(raw);
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) value = fenced[1].trim();
  try { return JSON.parse(value); } catch (_) {}
  const start = value.indexOf('{'); const end = value.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1));
  throw new Error('模型没有返回合法JSON。');
}

function estimateTokens(value) {
  try {
    const { estimateTextTokens } = require('../team-model-runtime');
    return Math.max(0, Number(estimateTextTokens(value)) || 0);
  } catch (_) {
    const raw = typeof value === 'string' ? value : JSON.stringify(value || {});
    return Math.ceil(String(raw || '').length / 3.5);
  }
}

function recordUsage(coreApp, req, stats, statusCode, elapsedMs) {
  if (!coreApp?.locals?.usageStore || typeof coreApp.locals.novelPanelConfig !== 'function') return;
  try {
    const configured = coreApp.locals.novelPanelConfig(req.username);
    const access = configured && configured.__qiantieAccess;
    if (!access) return;
    coreApp.locals.usageStore.record({
      username: access.member.username,
      billedTo: access.billedTo,
      teamOwner: access.teamOwner,
      feature: 'novel-panel',
      provider: access.config?.provider || configured.provider || '',
      model: access.config?.model || configured.model || '',
      status: Number(statusCode) < 400 ? 'success' : 'completed_error',
      usage: { prompt_tokens: stats.promptTokens, completion_tokens: stats.completionTokens, total_tokens: stats.promptTokens + stats.completionTokens },
      metadata: { operation: '/outline-scenes:v78.3.0.31-director-semantic', statusCode: Number(statusCode) || 500, usageEstimated: true, estimateBasis: 'multi-request-text-estimate', modelCalls: stats.modelCalls, elapsedMs: Math.max(0, Number(elapsedMs) || 0) },
    });
  } catch (_) {
    // Usage accounting must never turn a completed generation into an API failure.
  }
}

async function defaultRemoteJson(coreApp, req, { system, payload, maxTokens = 12000, temperature = 0 }) {
  const { readConfig, ensureReadyConfig, requestUpstream, collectResponse } = require('../shared');
  const configured = coreApp?.locals?.novelPanelConfig;
  const current = readConfig(req.username);
  const override = typeof configured === 'function' ? configured(req.username, current) : configured;
  const config = override && typeof override === 'object' ? { ...current, ...override } : current;
  ensureReadyConfig(config);
  const upstream = await requestUpstream(config, {
    model: config.model,
    stream: false,
    temperature,
    max_tokens: Math.max(256, Math.min(32768, Number(maxTokens) || 12000)),
    messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }],
  }, collectResponse, { timeoutMs: 400000 });
  if (upstream.statusCode >= 400) throw new Error(`上游模型返回 HTTP ${upstream.statusCode}`);
  const envelope = JSON.parse(upstream.text);
  return parseJsonContent(envelope?.choices?.[0]?.message?.content);
}

function shotDuration(shot = {}) {
  const segments = list(shot.timeline_segments);
  if (segments.length) {
    const sum = segments.reduce((total, segment) => {
      const explicit = number(segment.duration);
      if (explicit > 0) return total + explicit;
      const start = number(segment.start_offset ?? segment.start); const end = number(segment.end_offset ?? segment.end);
      return total + (end > start ? end - start : 0);
    }, 0);
    if (sum > 0) return sum;
  }
  return number(shot.duration ?? shot.seconds ?? shot.total_seconds);
}

function durationBySource(shots) {
  const map = new Map();
  list(shots).forEach(shot => {
    const idx = Number(shot && shot.source_index);
    if (!Number.isInteger(idx) || idx < 1) return;
    map.set(idx, (map.get(idx) || 0) + shotDuration(shot));
  });
  return map;
}

function auditRows(result, contract, rowCount) {
  const needed = new Set();
  constraintItems(contract).forEach(item => itemIndices(item, rowCount).forEach(idx => needed.add(idx)));
  const grouped = new Map();
  list(result && result.outline_shots).forEach(shot => {
    const idx = Number(shot && shot.source_index);
    if (!Number.isInteger(idx) || !needed.has(idx)) return;
    const row = grouped.get(idx) || { source_index: idx, source_basis: text(shot.source_basis), shots: [] };
    row.shots.push({ duration: shotDuration(shot), prompt: text(shot.prompt || shot.visual_prompt || shot.description || shot.content), timeline_segments: clone(list(shot.timeline_segments)) });
    grouped.set(idx, row);
  });
  return [...grouped.values()].sort((a, b) => a.source_index - b.source_index);
}

function mergeRepairShots(original, repaired, targets) {
  const targetSet = new Set(targets);
  const untouched = list(original).filter(shot => !targetSet.has(Number(shot && shot.source_index)));
  return [...untouched, ...list(repaired)].sort((a, b) => Number(a.source_index || 0) - Number(b.source_index || 0));
}

async function compileContract(remote, body, rows) {
  const parsed = await remote({ system: contractSystemPrompt(), payload: { protocol: 'outline_v3_clean_20260903_r8', operation: 'compile_generic_director_constraint_contract', source_scope: 'rows_are_complete_canonical_source', full_novel: '', must_cover_details: text(body.must_cover_details, 12000), shot_rhythm_requirements: text(body.shot_rhythm_requirements, 12000), rows, previous_context: null, next_source_preview: '' }, maxTokens: Math.max(3000, Math.min(9000, 1800 + rows.length * 500)), temperature: 0 });
  return validateConstraintContract(parsed, rows.length);
}

async function auditContract(remote, contract, result, rowCount) {
  if (!constraintItems(contract).length) return { ...Object.fromEntries(GROUPS.map(group => [group, []])), overall_passed: true };
  const parsed = await remote({ system: auditSystemPrompt(), payload: { protocol: 'outline_v3_clean_20260903_r8', operation: 'semantic_audit_director_constraints', director_constraint_contract: contract, generated_rows: auditRows(result, contract, rowCount) }, maxTokens: Math.max(3000, Math.min(9000, 1600 + constraintItems(contract).length * 450)), temperature: 0 });
  return validateConstraintAudit(parsed, contract, rowCount);
}

async function repairFailed(remote, body, contract, audit, result, rows) {
  const targets = failedSourceIndices(contract, audit, rows.length);
  if (!targets.length) throw new Error('导演要求语义验收失败，但无法定位需要修复的原文行。');
  const targetSet = new Set(targets);
  const failedIds = new Set(GROUPS.flatMap(group => list(audit[group]).filter(item => item.passed !== true).map(item => text(item.id))));
  const failedConstraints = constraintItems(contract).filter(item => failedIds.has(text(item.id)));
  const existingShots = list(result.outline_shots).filter(shot => targetSet.has(Number(shot && shot.source_index)));
  const parsed = await remote({
    system: repairSystemPrompt(body.generation_rules),
    payload: { protocol: 'outline_v3_clean_20260903_r8', operation: 'targeted_repair_failed_director_constraints_once', target_source_indices: targets, failed_constraints: failedConstraints, failed_audit: Object.fromEntries(GROUPS.map(group => [group, list(audit[group]).filter(item => item.passed !== true)])), source_rows: rows.filter(row => targetSet.has(row.source_index)), existing_shots: clone(existingShots), characters: clone(list(body.characters)) },
    maxTokens: Math.max(5000, Math.min(18000, 3500 + targets.length * 2600)),
    temperature: 0.1,
  });
  if (!parsed || !Array.isArray(parsed.outline_shots) || !parsed.outline_shots.length) throw new Error('导演要求定向修复没有返回outline_shots。');
  const returnedIndices = new Set(parsed.outline_shots.map(shot => Number(shot && shot.source_index)).filter(Number.isInteger));
  if ([...returnedIndices].some(idx => !targetSet.has(idx)) || targets.some(idx => !returnedIndices.has(idx))) throw new Error('导演要求定向修复返回了非目标行或漏掉目标行。');
  const beforeDuration = durationBySource(existingShots);
  const afterDuration = durationBySource(parsed.outline_shots);
  targets.forEach(idx => {
    const expected = beforeDuration.get(idx) || 0;
    const actual = afterDuration.get(idx) || 0;
    if (expected > 0 && Math.abs(expected - actual) > 0.05) throw new Error(`导演要求定向修复不得改变第${idx}行时长：原${expected}秒，返回${actual}秒。`);
  });
  return { targets, shots: parsed.outline_shots };
}

function createV783031OutlineHandler({ coreApp = null, remoteJson = null, resolveOutlinePreset = null, qualityGate = null } = {}) {
  return async function v783031OutlineHandler(req, res) {
    const username = text(req && req.username) || 'anonymous';
    if (activeUsers.has(username)) return res.status(409).json({ code: 'NOVEL_PANEL_OPERATION_IN_PROGRESS', error: '当前整段分镜正在处理中，请等待本次请求结束后再试。' });
    activeUsers.add(username);
    const body = req && req.body && typeof req.body === 'object' ? req.body : {};
    const novelText = text(body.novel_text, 500000);
    if (!novelText) { activeUsers.delete(username); return res.status(400).json({ error: '请先粘贴小说原文。' }); }
    const rows = sourceRows(novelText);
    const stats = { modelCalls: 0, promptTokens: 0, completionTokens: 0 };
    const startedAt = Date.now();
    const remoteBase = remoteJson || (args => defaultRemoteJson(coreApp, req, args));
    const remote = async args => {
      stats.modelCalls += 1;
      stats.promptTokens += estimateTokens({ system: args.system, payload: args.payload });
      const output = await remoteBase(args);
      stats.completionTokens += estimateTokens(output);
      return output;
    };
    const gate = qualityGate || ((result, context) => { const { validateOutlineApplyGate } = require('./quality-gate'); return validateOutlineApplyGate(result, context); });
    const preset = resolveOutlinePreset || (() => { try { const { resolveSystemPresetBody } = require('../system-preset-catalog'); return resolveSystemPresetBody(coreApp?.locals?.presetStore, 'novel-outline'); } catch (_) { return ''; } });
    try {
      const contract = await compileContract(remote, body, rows);
      const initial = await remote({ system: outlineSystemPrompt(preset(), contract), payload: { protocol: 'outline_v3_clean_20260903_r8', operation: 'generate_outline_with_director_constraint_contract', novel_text: novelText, generation_rules: text(body.generation_rules, 30000), must_cover_details: text(body.must_cover_details, 12000), shot_rhythm_requirements: text(body.shot_rhythm_requirements, 12000), director_constraint_contract: contract, characters: clone(list(body.characters)), outline_shots: clone(list(body.outline_shots)) }, maxTokens: 16000, temperature: 0.35 });
      if (!initial || !Array.isArray(initial.outline_shots) || !initial.outline_shots.length) throw new Error('模型没有返回分镜数组，原分镜未被覆盖。');
      let finalResult = { ...initial, outline_shots: clone(initial.outline_shots) };
      let report = gate(finalResult, { novelText, mode: 'outline', beforeShots: list(body.outline_shots) });
      if (report && report.ok === false) return res.status(422).json({ applied: false, code: 'OUTLINE_QUALITY_GATE_BLOCKED', retained_previous_result: true, report, error: '整段分镜质量校验未通过；本轮不会写入半成品。' });
      let audit = await auditContract(remote, contract, finalResult, rows.length);
      let repairUsed = false;
      if (!audit.overall_passed) {
        const repaired = await repairFailed(remote, body, contract, audit, finalResult, rows);
        finalResult.outline_shots = mergeRepairShots(finalResult.outline_shots, repaired.shots, repaired.targets);
        report = gate(finalResult, { novelText, mode: 'outline', beforeShots: list(body.outline_shots) });
        if (report && report.ok === false) return res.status(422).json({ applied: false, code: 'OUTLINE_QUALITY_GATE_BLOCKED', retained_previous_result: true, report, error: '导演要求定向修复后质量校验未通过；本轮不会写入半成品。' });
        repairUsed = true;
        audit = await auditContract(remote, contract, finalResult, rows.length);
        if (!audit.overall_passed) return res.status(422).json({ applied: false, code: 'V783020_DIRECTOR_CONSTRAINT_AUDIT_FAILED', retained_previous_result: true, director_constraint_contract: contract, director_constraint_audit: audit, error: '人工导演要求在一次定向修复后仍未全部落实；本轮事务不会写入半成品。' });
      }
      return res.json({ ...finalResult, applied: true, report, director_constraint_contract: contract, director_constraint_audit: audit, director_constraint_repair_used: repairUsed, semantic_contract_version: 'outline_v3_r8_director_constraint_contract', architecture: 'browser_one_request -> generic_director_constraint_contract -> outline_generation -> semantic_constraint_audit -> targeted_failed_rows_repair_once_if_needed -> semantic_reaudit -> atomic_return' });
    } catch (error) {
      if (res.destroyed || res.writableEnded) return undefined;
      return res.status(502).json({ applied: false, code: 'V783020_DIRECTOR_SEMANTIC_PIPELINE_FAILED', retained_previous_result: true, error: text(error && error.message) || '导演语义合同执行失败。' });
    } finally {
      activeUsers.delete(username);
      recordUsage(coreApp, req, stats, res.statusCode || 200, Date.now() - startedAt);
    }
  };
}

module.exports = { VERSION, validateConstraintContract, validateConstraintAudit, failedSourceIndices, createV783031OutlineHandler, _private: { sourceRows, constraintItems, itemIndices, auditRows, mergeRepairShots, shotDuration, durationBySource, contractSystemPrompt, auditSystemPrompt, repairSystemPrompt, outlineSystemPrompt } };
