'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readConfig, ensureReadyConfig, requestUpstream, collectResponse } = require('./shared');
const { normalizeAudioTargetSeconds } = require('./script-generation-rules');
const {
  validateConstraintContract,
  validateConstraintAudit,
  failedSourceIndices,
  _private: v78
} = require('./novel-panel/v783031-outline-route');
const { validateOutlineApplyGate } = require('./novel-panel/quality-gate');

const PLAN_SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '..', 'prompts', '剧本导演全局计划.md'), 'utf8');
const EXECUTION_SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '..', 'prompts', '剧本完整视频画面提示词.md'), 'utf8');
const CONTRACT_GROUPS = ['must_cover', 'rhythm', 'row_guidance', 'scene_progression'];
const MAX_SOURCE_CHARS = 180000;
const MAX_ENTITY_ITEMS = 60;
const MAX_TRANSPORT_BATCH_UNITS = 12;
const EPSILON = 0.05;

function text(value, limit = 0) {
  const result = String(value == null ? '' : value).trim();
  return limit ? result.slice(0, limit) : result;
}

function list(value) { return Array.isArray(value) ? value : []; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function near(a, b, epsilon = EPSILON) { return Math.abs(Number(a) - Number(b)) <= epsilon; }

function compactSource(value) {
  return String(value || '').replace(/[\s\u3000]+/g, '');
}

function safeEntityList(value) {
  return clone(list(value).slice(0, MAX_ENTITY_ITEMS));
}

function emptyConstraintContract() {
  return {
    contract_version: 'director_constraint_contract_v1',
    ...Object.fromEntries(CONTRACT_GROUPS.map(group => [group, []]))
  };
}

function normalizeDirectorPipelineRequest(body = {}) {
  const novelText = text(body.novelText ?? body.novel_text, MAX_SOURCE_CHARS);
  if (!novelText) throw new Error('剧本导演流水线需要完整原文。');
  const duration = body.duration === '15s' ? '15s' : '10s';
  const maxUnitSeconds = duration === '15s' ? 15 : 10;
  const matchAudio = body.matchAudio === true || body.match_audio === true;
  const audioTotalSeconds = matchAudio
    ? normalizeAudioTargetSeconds(body.audioTotalSeconds ?? body.audio_total_seconds)
    : null;
  if (matchAudio && !audioTotalSeconds) throw new Error('匹配音频模式需要有效的实际音频总时长。');
  return {
    novelText,
    duration,
    maxUnitSeconds,
    matchAudio,
    audioTotalSeconds,
    mode: text(body.mode, 40) || 'continuous',
    descriptionMode: text(body.descriptionMode, 40) || 'strict',
    mustCoverDetails: text(body.mustCoverDetails ?? body.must_cover_details, 12000),
    shotRhythmRequirements: text(body.shotRhythmRequirements ?? body.shot_rhythm_requirements, 12000),
    visualStyle: text(body.visualStyle ?? body.smart_unified_style, 20000),
    characters: safeEntityList(body.characters),
    scenes: safeEntityList(body.scenes),
    constraints: body.constraints && typeof body.constraints === 'object' ? clone(body.constraints) : {}
  };
}

function planField(value, name, limit = 2400) {
  const result = text(value, limit);
  if (!result) throw new Error(`Global Director Plan 缺少 ${name}。`);
  return result;
}

function validateGlobalDirectorPlan(raw, {
  novelText,
  maxUnitSeconds = 10,
  matchAudio = false,
  audioTotalSeconds = null
} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Global Director Plan 必须是 JSON 对象。');
  if (raw.plan_version !== 'script_global_director_plan_v1') throw new Error('Global Director Plan 版本无效。');
  const source = text(novelText, MAX_SOURCE_CHARS);
  if (!source) throw new Error('Global Director Plan 校验缺少完整原文。');
  const units = list(raw.source_units);
  if (!units.length) throw new Error('Global Director Plan 没有 source_units。');
  if (units.length > 1200) throw new Error('Global Director Plan source_units 数量异常。');

  const closedBatches = new Set();
  let currentBatch = '';
  let totalDuration = 0;
  const clean = units.map((unit, index) => {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)) throw new Error(`Global Director Plan 第 ${index + 1} 项不是对象。`);
    const sourceIndex = Number(unit.source_index);
    if (!Number.isInteger(sourceIndex) || sourceIndex !== index + 1) throw new Error('Global Director Plan source_index 必须从 1 连续递增。');
    const sourceText = planField(unit.source_text, `source_units[${index}].source_text`, 20000);
    const sceneId = planField(unit.scene_id, `source_units[${index}].scene_id`, 80);
    const eventId = planField(unit.event_id, `source_units[${index}].event_id`, 80);
    const batchId = planField(unit.batch_id, `source_units[${index}].batch_id`, 80);
    const duration = finite(unit.duration);
    if (duration === null || duration <= 0 || duration > maxUnitSeconds + EPSILON) {
      throw new Error(`Global Director Plan 第 ${sourceIndex} 单元时长必须大于 0 且不超过 ${maxUnitSeconds} 秒。`);
    }
    if (!Number.isInteger(duration)) throw new Error(`Global Director Plan 第 ${sourceIndex} 单元时长必须使用整数秒，保证与当前 V88 时间轴格式一致。`);

    if (currentBatch && batchId !== currentBatch) closedBatches.add(currentBatch);
    if (closedBatches.has(batchId)) throw new Error(`Global Director Plan batch_id ${batchId} 非连续出现；语义批次不得离开后再次返回。`);
    currentBatch = batchId;
    totalDuration += duration;
    return {
      source_index: sourceIndex,
      source_text: sourceText,
      scene_id: sceneId,
      event_id: eventId,
      batch_id: batchId,
      duration,
      narrative_function: planField(unit.narrative_function, `source_units[${index}].narrative_function`),
      visual_goal: planField(unit.visual_goal, `source_units[${index}].visual_goal`),
      continuity_in: planField(unit.continuity_in, `source_units[${index}].continuity_in`),
      continuity_out: planField(unit.continuity_out, `source_units[${index}].continuity_out`)
    };
  });

  if (compactSource(clean.map(unit => unit.source_text).join('')) !== compactSource(source)) {
    throw new Error('Global Director Plan 的 source_units 没有按顺序完整覆盖原文，或发生了原文篡改。');
  }
  if (matchAudio) {
    const target = finite(audioTotalSeconds);
    if (target === null || !near(totalDuration, target)) {
      throw new Error(`匹配音频 Global Director Plan 总时长必须精确等于 ${audioTotalSeconds} 秒，当前为 ${totalDuration} 秒。`);
    }
  }
  return {
    plan_version: 'script_global_director_plan_v1',
    story_summary: text(raw.story_summary, 5000),
    source_units: clean,
    total_duration: totalDuration
  };
}

function buildCanonicalSourceRows(plan) {
  return list(plan?.source_units).map(unit => ({
    source_index: Number(unit.source_index),
    source_text: text(unit.source_text),
    guidance: [
      `叙事作用：${text(unit.narrative_function)}`,
      `视觉目标：${text(unit.visual_goal)}`,
      `进入状态：${text(unit.continuity_in)}`,
      `离开状态：${text(unit.continuity_out)}`
    ].join('；')
  }));
}

function executionShotPrompt(value, label) {
  const result = text(value, 8000);
  if (!result) throw new Error(`${label} 画面 prompt 不能为空。`);
  return result;
}

function validateDirectorExecution(raw, plan, { matchAudio = false, audioTotalSeconds = null } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('执行导演结果必须是 JSON 对象。');
  const shots = list(raw.outline_shots);
  const units = list(plan?.source_units);
  if (shots.length !== units.length) throw new Error(`执行导演必须严格一条 source_unit 对应一张外层画面卡；计划 ${units.length} 条，返回 ${shots.length} 条。`);
  const unitByIndex = new Map(units.map(unit => [Number(unit.source_index), unit]));
  if (unitByIndex.size !== units.length || [...unitByIndex.keys()].some(index => !Number.isInteger(index) || index < 1)) {
    throw new Error('执行导演校验收到无效的 Global Plan source_index。');
  }
  const seen = new Set();
  let totalDuration = 0;
  const cleanShots = shots.map((shot, position) => {
    if (!shot || typeof shot !== 'object' || Array.isArray(shot)) throw new Error(`第 ${position + 1} 张外层画面卡无效。`);
    const sourceIndex = Number(shot.source_index);
    if (!Number.isInteger(sourceIndex) || !unitByIndex.has(sourceIndex) || seen.has(sourceIndex)) throw new Error('执行导演 source_index 缺失、越界或重复。');
    seen.add(sourceIndex);
    const unit = unitByIndex.get(sourceIndex);
    const sourceBasis = text(shot.source_basis, 20000);
    if (sourceBasis !== text(unit.source_text)) throw new Error(`第 ${sourceIndex} 张卡 source_basis 与 Global Plan 原文映射不一致。`);
    for (const key of ['scene_id', 'event_id', 'batch_id']) {
      if (text(shot[key]) !== text(unit[key])) throw new Error(`第 ${sourceIndex} 张卡 ${key} 漂移，必须继承 Global Plan。`);
    }
    const duration = finite(shot.duration);
    if (duration === null || !near(duration, unit.duration)) throw new Error(`第 ${sourceIndex} 张卡 duration/时长必须保持 Global Plan 的 ${unit.duration} 秒。`);
    const segments = list(shot.timeline_segments);
    if (segments.length < 1 || segments.length > 6) throw new Error(`第 ${sourceIndex} 张卡 micro/微镜头数量必须为 1 到 6。`);
    let cursor = 0;
    const cleanSegments = segments.map((segment, segmentIndex) => {
      if (!segment || typeof segment !== 'object' || Array.isArray(segment)) throw new Error(`第 ${sourceIndex} 张卡第 ${segmentIndex + 1} 个微镜头无效。`);
      const start = finite(segment.start_offset ?? segment.start);
      const end = finite(segment.end_offset ?? segment.end);
      const explicitDuration = finite(segment.duration);
      if (start === null || end === null || end <= start) throw new Error(`第 ${sourceIndex} 张卡微镜头时间无效。`);
      if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error(`第 ${sourceIndex} 张卡微镜头时间必须使用整数秒。`);
      if (!near(start, cursor)) throw new Error(`第 ${sourceIndex} 张卡微镜头时间不连续，存在空缺或重叠。`);
      const computed = end - start;
      if (explicitDuration !== null && !near(explicitDuration, computed)) throw new Error(`第 ${sourceIndex} 张卡微镜头 duration 与起止时间不一致。`);
      cursor = end;
      return {
        ...clone(segment),
        start_offset: start,
        end_offset: end,
        duration: computed,
        shot_size: planField(segment.shot_size, `第${sourceIndex}张卡 shot_size`, 120),
        angle: planField(segment.angle, `第${sourceIndex}张卡 angle`, 180),
        movement: planField(segment.movement, `第${sourceIndex}张卡 movement`, 180),
        prompt: executionShotPrompt(segment.prompt || segment.visual_prompt || segment.description || segment.content, `第${sourceIndex}张卡第${segmentIndex + 1}微镜头`)
      };
    });
    if (!near(cursor, duration)) throw new Error(`第 ${sourceIndex} 张卡最后一个微镜头必须结束于总时长 ${duration} 秒。`);
    totalDuration += duration;
    return {
      ...clone(shot),
      source_index: sourceIndex,
      source_basis: sourceBasis,
      scene_id: unit.scene_id,
      event_id: unit.event_id,
      batch_id: unit.batch_id,
      duration,
      prompt: executionShotPrompt(shot.prompt || shot.visual_prompt || shot.description || shot.content, `第${sourceIndex}张外层卡`),
      timeline_segments: cleanSegments
    };
  });
  if (seen.size !== unitByIndex.size) throw new Error('执行导演遗漏 Global Plan source_unit。');
  cleanShots.sort((a, b) => a.source_index - b.source_index);
  if (matchAudio && !near(totalDuration, audioTotalSeconds)) throw new Error(`执行导演总时长必须精确等于音频 ${audioTotalSeconds} 秒。`);
  return { ...clone(raw), outline_shots: cleanShots, total_duration: totalDuration };
}

function semanticBatches(plan) {
  const groups = [];
  let current = null;
  for (const unit of list(plan?.source_units)) {
    if (!current || current.batch_id !== unit.batch_id) {
      current = { batch_id: unit.batch_id, units: [] };
      groups.push(current);
    }
    current.units.push(unit);
  }
  return groups;
}

function transportBatches(plan) {
  return semanticBatches(plan).flatMap(group => {
    const parts = [];
    for (let index = 0; index < group.units.length; index += MAX_TRANSPORT_BATCH_UNITS) {
      parts.push({
        batch_id: group.batch_id,
        transport_part: Math.floor(index / MAX_TRANSPORT_BATCH_UNITS) + 1,
        units: group.units.slice(index, index + MAX_TRANSPORT_BATCH_UNITS)
      });
    }
    return parts;
  });
}

function previousExecutionContext(shots) {
  const last = list(shots).at(-1);
  if (!last) return null;
  return {
    source_index: last.source_index,
    scene_id: last.scene_id,
    event_id: last.event_id,
    continuity_visual_result: text(last.prompt, 2400),
    last_micro_shot: clone(list(last.timeline_segments).at(-1) || null)
  };
}

function nextSourcePreview(plan, lastSourceIndex) {
  return list(plan?.source_units)
    .filter(unit => unit.source_index > lastSourceIndex)
    .slice(0, 2)
    .map(unit => ({ source_index: unit.source_index, source_text: unit.source_text, scene_id: unit.scene_id, event_id: unit.event_id }))
    .map(item => JSON.stringify(item))
    .join('\n');
}

async function defaultRemoteJson(req, { system, payload, maxTokens = 12000, temperature = 0.2 }) {
  const config = readConfig(req.username);
  ensureReadyConfig(config);
  const upstream = await requestUpstream(config, {
    model: config.model,
    stream: false,
    temperature,
    max_tokens: Math.max(512, Math.min(32768, Number(maxTokens) || 12000)),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(payload) }
    ]
  }, collectResponse, { timeoutMs: 400000 });
  if (upstream.statusCode >= 400) throw new Error(`导演流水线上游模型返回 HTTP ${upstream.statusCode}`);
  let envelope;
  try { envelope = JSON.parse(upstream.text); } catch { throw new Error('导演流水线上游模型未返回有效 JSON envelope。'); }
  let content = text(envelope?.choices?.[0]?.message?.content);
  const fenced = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) content = fenced[1].trim();
  try { return JSON.parse(content); } catch {
    const start = content.indexOf('{'); const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(content.slice(start, end + 1));
    throw new Error('导演流水线模型没有返回合法 JSON。');
  }
}

async function compileDirectorContract(remote, input, rows) {
  // 没有人工“必须拍出/节奏”要求时合同应为空；不为得到四个空数组多做一次 AI 调用。
  if (!input.mustCoverDetails && !input.shotRhythmRequirements) return emptyConstraintContract();
  const parsed = await remote({
    system: v78.contractSystemPrompt(),
    payload: {
      protocol: 'outline_v3_clean_20260903_r8',
      operation: 'compile_generic_director_constraint_contract',
      source_scope: 'rows_are_complete_canonical_source',
      full_novel: '',
      must_cover_details: input.mustCoverDetails,
      shot_rhythm_requirements: input.shotRhythmRequirements,
      rows,
      previous_context: null,
      next_source_preview: ''
    },
    maxTokens: Math.max(3000, Math.min(10000, 1800 + rows.length * 450)),
    temperature: 0
  });
  return validateConstraintContract(parsed, rows.length);
}

function contractItems(contract) {
  return CONTRACT_GROUPS.flatMap(group => list(contract?.[group]).map(item => ({ ...item, group })));
}

async function auditDirectorContract(remote, contract, result, rows) {
  if (!contractItems(contract).length) {
    return { ...Object.fromEntries(CONTRACT_GROUPS.map(group => [group, []])), overall_passed: true };
  }
  const parsed = await remote({
    system: v78.auditSystemPrompt(),
    payload: {
      protocol: 'outline_v3_clean_20260903_r8',
      operation: 'semantic_audit_director_constraints',
      director_constraint_contract: contract,
      generated_rows: v78.auditRows(result, contract, rows.length)
    },
    maxTokens: Math.max(3000, Math.min(10000, 1600 + contractItems(contract).length * 450)),
    temperature: 0
  });
  return validateConstraintAudit(parsed, contract, rows.length);
}

async function repairDirectorFailures(remote, input, contract, audit, result, rows) {
  const targets = failedSourceIndices(contract, audit, rows.length);
  if (!targets.length) throw new Error('导演语义验收失败，但无法定位需要修复的 source_index。');
  const targetSet = new Set(targets);
  const failedIds = new Set(CONTRACT_GROUPS.flatMap(group => list(audit?.[group]).filter(item => item.passed !== true).map(item => text(item.id))));
  const failedConstraints = contractItems(contract).filter(item => failedIds.has(text(item.id)));
  const existingShots = list(result.outline_shots).filter(shot => targetSet.has(Number(shot?.source_index)));
  const parsed = await remote({
    system: v78.repairSystemPrompt(`${EXECUTION_SYSTEM_PROMPT}\n\n全局计划已经确定，修复时不得重新分段或改变 source_index/duration。`),
    payload: {
      protocol: 'outline_v3_clean_20260903_r8',
      operation: 'targeted_repair_failed_director_constraints_once',
      target_source_indices: targets,
      failed_constraints: failedConstraints,
      failed_audit: Object.fromEntries(CONTRACT_GROUPS.map(group => [group, list(audit?.[group]).filter(item => item.passed !== true)])),
      source_rows: rows.filter(row => targetSet.has(row.source_index)),
      global_director_plan_units: input.globalDirectorPlan.source_units.filter(unit => targetSet.has(unit.source_index)),
      existing_shots: clone(existingShots),
      characters: clone(input.characters),
      scenes: clone(input.scenes),
      smart_unified_style: input.visualStyle
    },
    maxTokens: Math.max(5000, Math.min(18000, 3500 + targets.length * 2600)),
    temperature: 0.1
  });
  if (!parsed || !Array.isArray(parsed.outline_shots) || !parsed.outline_shots.length) throw new Error('导演要求定向修复没有返回 outline_shots。');
  const returned = new Set(parsed.outline_shots.map(shot => Number(shot?.source_index)).filter(Number.isInteger));
  if ([...returned].some(index => !targetSet.has(index)) || targets.some(index => !returned.has(index))) throw new Error('导演要求定向修复返回了非目标行或漏掉目标行。');
  const before = v78.durationBySource(existingShots);
  const after = v78.durationBySource(parsed.outline_shots);
  targets.forEach(index => {
    if (!near(before.get(index) || 0, after.get(index) || 0)) throw new Error(`导演要求定向修复不得改变第 ${index} 单元时长。`);
  });
  return { targets, shots: parsed.outline_shots };
}

function mergeRepairedShots(original, repaired) {
  return v78.mergeRepairShots(original, repaired.shots, repaired.targets);
}

function buildPlanPayload(input) {
  return {
    operation: 'build_global_director_plan',
    full_source: input.novelText,
    max_unit_seconds: input.maxUnitSeconds,
    duration_precision: 'integer_seconds_required_for_current_v88_timeline_contract',
    match_audio: input.matchAudio,
    audio_total_seconds: input.audioTotalSeconds,
    mode: input.mode,
    description_mode: input.descriptionMode,
    must_cover_details: input.mustCoverDetails,
    shot_rhythm_requirements: input.shotRhythmRequirements,
    smart_unified_style: input.visualStyle,
    characters: input.characters,
    scenes: input.scenes
  };
}

function generationRuleSummary(input) {
  const restriction = text(input.constraints?.restriction?.body, 8000);
  return [
    `视频单元最大时长：${input.maxUnitSeconds}秒。`,
    '当前 V88 时间轴使用整数秒；外层 duration 和 micro-shot 起止时间必须为整数秒。',
    input.matchAudio ? `音频总时长硬约束：${input.audioTotalSeconds}秒，所有外层卡总时长必须严格相等。` : '',
    input.mustCoverDetails ? `必须拍出：${input.mustCoverDetails}` : '',
    input.shotRhythmRequirements ? `镜头节奏：${input.shotRhythmRequirements}` : '',
    restriction ? `当前额外限制：${restriction}` : ''
  ].filter(Boolean).join('\n');
}

async function runScriptDirectorPipeline({ req, body, remoteJson = null } = {}) {
  const input = normalizeDirectorPipelineRequest(body);
  const remote = args => (remoteJson || (options => defaultRemoteJson(req, options)))(args);
  const rawPlan = await remote({
    system: PLAN_SYSTEM_PROMPT,
    payload: buildPlanPayload(input),
    maxTokens: Math.max(7000, Math.min(20000, 5000 + Math.ceil(input.novelText.length / 45))),
    temperature: 0.15
  });
  const globalDirectorPlan = validateGlobalDirectorPlan(rawPlan, input);
  input.globalDirectorPlan = globalDirectorPlan;
  const rows = buildCanonicalSourceRows(globalDirectorPlan);
  const contract = await compileDirectorContract(remote, input, rows);

  const generatedShots = [];
  const batches = transportBatches(globalDirectorPlan);
  for (const batch of batches) {
    const rawBatch = await remote({
      system: EXECUTION_SYSTEM_PROMPT,
      payload: {
        operation: 'execute_authoritative_video_prompt_batch',
        generation_rules: generationRuleSummary(input),
        global_director_plan: {
          plan_version: globalDirectorPlan.plan_version,
          story_summary: globalDirectorPlan.story_summary,
          total_duration: globalDirectorPlan.total_duration
        },
        current_batch_id: batch.batch_id,
        transport_part: batch.transport_part,
        current_source_units: batch.units,
        previous_context: previousExecutionContext(generatedShots),
        next_source_preview: nextSourcePreview(globalDirectorPlan, batch.units.at(-1).source_index),
        director_constraint_contract: contract,
        characters: input.characters,
        scenes: input.scenes,
        smart_unified_style: input.visualStyle
      },
      maxTokens: Math.max(6000, Math.min(20000, 3500 + batch.units.length * 2600)),
      temperature: 0.3
    });
    const subsetPlan = { ...globalDirectorPlan, source_units: batch.units };
    const checkedBatch = validateDirectorExecution(rawBatch, subsetPlan);
    generatedShots.push(...checkedBatch.outline_shots);
  }

  let finalResult = validateDirectorExecution({ outline_shots: generatedShots }, globalDirectorPlan, input);
  const canonicalNovelText = rows.map(row => row.source_text).join('\n');
  let report = validateOutlineApplyGate(finalResult, { novelText: canonicalNovelText, mode: 'outline' });
  if (report?.ok === false) {
    const error = new Error('完整视频画面提示词质量校验未通过，本轮不会返回半成品。');
    error.statusCode = 422;
    error.code = 'SCRIPT_DIRECTOR_QUALITY_GATE_BLOCKED';
    error.report = report;
    throw error;
  }

  let audit = await auditDirectorContract(remote, contract, finalResult, rows);
  let repairUsed = false;
  if (!audit.overall_passed) {
    const repaired = await repairDirectorFailures(remote, input, contract, audit, finalResult, rows);
    finalResult = validateDirectorExecution({ outline_shots: mergeRepairedShots(finalResult.outline_shots, repaired) }, globalDirectorPlan, input);
    report = validateOutlineApplyGate(finalResult, { novelText: canonicalNovelText, mode: 'outline' });
    if (report?.ok === false) {
      const error = new Error('导演要求定向修复后质量校验仍未通过，本轮不会返回半成品。');
      error.statusCode = 422;
      error.code = 'SCRIPT_DIRECTOR_REPAIR_QUALITY_GATE_BLOCKED';
      error.report = report;
      throw error;
    }
    repairUsed = true;
    audit = await auditDirectorContract(remote, contract, finalResult, rows);
    if (!audit.overall_passed) {
      const error = new Error('人工导演要求在一次定向修复后仍未全部落实，本轮不会返回半成品。');
      error.statusCode = 422;
      error.code = 'SCRIPT_DIRECTOR_CONSTRAINT_AUDIT_FAILED';
      error.audit = audit;
      throw error;
    }
  }

  return {
    applied: true,
    global_director_plan: globalDirectorPlan,
    outline_shots: finalResult.outline_shots,
    director_constraint_contract: contract,
    director_constraint_audit: audit,
    director_constraint_repair_used: repairUsed,
    report,
    architecture: 'smart_unified -> global_director_plan -> semantic_batches -> authoritative_micro_shot_execution -> v78_quality_gate -> v78_semantic_audit -> targeted_failed_rows_repair_once_if_needed -> semantic_reaudit -> deterministic_v88_formatter',
    output_text: formatDirectorPipelineOutput(finalResult, globalDirectorPlan)
  };
}

function formatClock(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function chineseOrdinal(index) {
  const values = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return values[index] || String(index + 1);
}

function formatDirectorPipelineOutput(result, plan) {
  const units = new Map(list(plan?.source_units).map(unit => [unit.source_index, unit]));
  return list(result?.outline_shots)
    .slice()
    .sort((a, b) => Number(a.source_index) - Number(b.source_index))
    .map((shot, index) => {
      const unit = units.get(Number(shot.source_index));
      const duration = Number(shot.duration || unit?.duration || 0);
      const lines = [
        `### 分镜${chineseOrdinal(index)}（总时长：${duration}s）`,
        `镜头画面：${text(shot.prompt)}`
      ];
      list(shot.timeline_segments).forEach(segment => {
        const camera = [text(segment.shot_size), text(segment.angle), text(segment.movement)].filter(Boolean).join('｜');
        lines.push(`${formatClock(segment.start_offset)}-${formatClock(segment.end_offset)} | ${camera} | ${text(segment.prompt)}`);
      });
      return lines.join('\n');
    })
    .join('\n\n---\n\n');
}

module.exports = {
  PLAN_SYSTEM_PROMPT,
  EXECUTION_SYSTEM_PROMPT,
  normalizeDirectorPipelineRequest,
  validateGlobalDirectorPlan,
  buildCanonicalSourceRows,
  validateDirectorExecution,
  semanticBatches,
  transportBatches,
  formatDirectorPipelineOutput,
  runScriptDirectorPipeline,
  _private: {
    compileDirectorContract,
    auditDirectorContract,
    repairDirectorFailures,
    generationRuleSummary,
    buildPlanPayload,
    previousExecutionContext,
    nextSourcePreview,
    defaultRemoteJson,
    compactSource,
    emptyConstraintContract
  }
};
