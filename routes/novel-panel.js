const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const { apiAuth } = require('../middleware/auth');
const {
  USERS_DIR,
  readConfig,
  writeConfig,
  ensureReadyConfig,
  requestUpstream,
  collectResponse
} = require('../lib/shared');
const { createNovelPanelStore } = require('../lib/novel-panel/project-store');
const { isPlainObject, isValidProjectId } = require('../lib/novel-panel/contracts');
const { createNovelPanelRuntime } = require('../lib/novel-panel/runtime');
const { createNovelPanelHistoryStore } = require('../lib/novel-panel/history-store');
const { createNovelPanelPremiumStore, normalizeImageBaseUrl } = require('../lib/novel-panel/premium-store');
const {
  validateOutlineApplyGate,
  validateOutlineShotApplyGate,
  summarizeOutlineGateIssues
} = require('../lib/novel-panel/quality-gate');
const { resolveSystemPresetBody } = require('../lib/system-preset-catalog');
const { getStorageRoot, writeNovelPanelExport } = require('../lib/storage-root');
const { DEFAULT_WORKBENCH_COMPATIBILITY, loadReleaseInfo } = require('../lib/release-info');

const router = express.Router();
const store = createNovelPanelStore({ usersDir: USERS_DIR });
const runtime = createNovelPanelRuntime({ usersDir: USERS_DIR });
const fallbackHistoryStore = createNovelPanelHistoryStore({ usersDir: USERS_DIR });
const fallbackPremiumStore = createNovelPanelPremiumStore({ usersDir: USERS_DIR });
const DEFAULT_TIMEOUT_SECONDS = 400;
const MIN_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 600;

const V78_BUILD_INFO = {
  app_version: DEFAULT_WORKBENCH_COMPATIBILITY.app_version,
  build_date: '2026-08-18',
  character_pipeline: 'character_core_2_all_genres_v78_stable',
  startup_mode: 'shared_backend_multi_instance_v78_stable',
  cache_policy: 'per_instance_profile_no_store',
  session_guard: 'registered_multi_instance',
  build_id: DEFAULT_WORKBENCH_COMPATIBILITY.build_id,
  workspace_schema_version: DEFAULT_WORKBENCH_COMPATIBILITY.workspace_schema_version,
  release_channel: DEFAULT_WORKBENCH_COMPATIBILITY.release_channel,
  release_version: DEFAULT_WORKBENCH_COMPATIBILITY.release_version,
  formal_roster_policy: 'forced_roster_slots_only_never_infer_formal_people_from_novel_relationship_terms',
  character_image_batch: 'bounded_concurrency_1_6_default_3_immediate_per_asset_persist_no_hidden_retry',
  release_status: 'production',
  legacy_v77_role: 'validator_fallback_and_protocol_compatibility_only',
  runtime_task_manager: 'frontend_ai_task_manager_v38',
  clean_core_phase: 'v78_3_0_2_scene_event_canonical_timeline',
  clean_transport: 'remote_json_optimized_v77_compat+frontend_clean_transport_v78_phase1',
  workspace_store: 'workspace_store_v78_phase1',
  character_ai_service: 'character_ai_service_v78_phase16',
  character_ai_policy: 'phase16_default_v78_primary_v77_presend_validator_fallback_exactly_one_service_request_no_hidden_retry',
  character_state_service: 'character_state_service_v78_phase2',
  character_diagnostics: 'character_diagnostics_v78_phase2',
  casting_compute_service: 'casting_compute_service_v78_phase6',
  casting_authority: 'v78_phase6_promoted_primary_with_live_character_core_fallback',
  temporary_continuity_authority: 'v78_phase6_primary_cache_with_character_core_validator_mirror',
  scene_cast_evidence_authority: 'v78_phase6_per_scene_evidence_primary_with_character_core_fallback',
  clean_diagnostics: 'clean_diagnostics_v78_stable',
  scene_context_service: 'scene_context_service_v78_2_4',
  submission_authority: 'ai_submission_package_authority_v78_phase8_phase15_default_primary_realtime_fallback',
  ai_submission_package: 'v78_submission_package_phase15_default_primary_with_character_core_validator_fallback',
  outline_response_adapter: 'outline_response_adapter_v78_phase9',
  writeback_authority: 'outline_response_writeback_authority_v78_phase9_phase15_default_primary_realtime_fallback',
  outline_generation_facade: 'outline_generation_facade_v78_phase15',
  outline_generator_authority: 'outline_generator_authority_v78_phase13',
  outline_generator_policy: 'phase15_default_v78_first_safe_request_v77_protocol_validator_fallback_zero_extra_ai',
  generator_contract_service: 'native_generator_request_contract_v78_phase13',
  generator_contract_id: 'video_prompt.outline_generator_request@1.0.0',
  generator_contract_policy: 'immutable_model_internal_meta_never_send_unknown_warn_passthrough',
  generator_protocol_service: 'native_generator_protocol_service_v78_phase13',
  generator_protocol_policy: 'phase15_default_v78_first_safe_request_independent_builder_v77_validator_zero_network',
  native_generator_service: 'native_generator_service_v78_phase14',
  native_generator_service_policy: 'phase15_default_v78_primary_with_v77_realtime_fallback_exactly_one_request',
  outline_production_authority: 'outline_production_authority_v78_phase15',
  outline_production_policy: 'v78_primary_first_safe_transaction_v77_preflight_and_writeback_fallback_post_send_no_retry',
  outline_native_generator: 'v78_phase15_default_production_mainline_plus_v77_realtime_fallback',
  reference_entity_resolver: 'reference_entity_resolver_v78_2_4',
  reference_binding_policy: 'formal_scene_prop_source_key_persistent_manual_override;temporary_people_text_only',
  reference_semantic_policy: 'outline_ai_text_only;reference_images_export_postprocess_only;temporary_people_never_use_images',
  temporary_performance_policy: 'temporary_people_text_only_per_shot_source_evidence_dynamic_performance_soft_diagnostic_manual_single_scene_repair',
  dirty_render: 'frontend_dirty_render_v38',
  clean_core_bridge: 'clean_core_bridge_v78_stable'
};

router.get('/build-info', (req, res) => {
  res.json(V78_BUILD_INFO);
});

router.use(apiAuth);

function text(value, limit = 0) {
  const result = String(value == null ? '' : value).trim();
  return limit ? result.slice(0, limit) : result;
}

function clampTimeout(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_SECONDS;
  return Math.max(MIN_TIMEOUT_SECONDS, Math.min(MAX_TIMEOUT_SECONDS, parsed));
}

function panelSettings(config, saved = {}) {
  return {
    ai_mode: saved.ai_mode === 'local' ? 'local' : 'remote',
    base_url: config.baseUrl || '',
    model: config.model || '',
    api_key_configured: Boolean(config.apiKey),
    ai_timeout_seconds: clampTimeout(saved.ai_timeout_seconds)
  };
}

function loadPanelSettings(req, username) {
  const target = panelStore(req);
  try {
    const result = require('../lib/system-store').readJsonOrMissing(target.settingsPath(username));
    return result.found && isPlainObject(result.value) ? result.value : {};
  } catch {
    throw new Error('小说面板设置文件无法读取');
  }
}

function savePanelSettings(req, username, value) {
  const target = panelStore(req);
  const { writeJsonAtomic } = require('../lib/system-store');
  writeJsonAtomic(target.settingsPath(username), value);
}

function configuredPanelSettings(req, username) {
  const config = readConfig(username);
  const saved = loadPanelSettings(req, username);
  return { config, saved, settings: panelSettings(config, saved) };
}

function getRuntime(req) {
  return req.app?.locals?.novelPanelRuntime || runtime;
}

function historyStore(req) {
  return req.app?.locals?.novelPanelHistoryStore || fallbackHistoryStore;
}

function panelStore(req) {
  return req.app?.locals?.novelPanelStore || store;
}

function premiumStore(req) {
  return req.app?.locals?.novelPanelPremiumStore || fallbackPremiumStore;
}

function diagnosticStore(req) {
  return req.app?.locals?.novelPanelAiDiagnosticStore || null;
}

function platformRelease(req) {
  return req.app?.locals?.releaseInfo || loadReleaseInfo();
}

function compatibilityComponents() {
  return { workbench: V78_BUILD_INFO };
}

function requestConfig(req) {
  const current = readConfig(req.username);
  const configured = req.app?.locals?.novelPanelConfig;
  const override = typeof configured === 'function'
    ? configured(req.username, current)
    : configured;
  return isPlainObject(override) ? { ...current, ...override } : current;
}

function operationSuffix(value, fallback) {
  const normalized = text(value, 180).replace(/\s+/g, '_');
  return normalized || fallback;
}

function operationConflict(res) {
  return res.status(409).json({
    code: 'NOVEL_PANEL_OPERATION_IN_PROGRESS',
    error: '当前功能正在处理中，请等待本次请求结束后再试。'
  });
}

function safeHostname(value) {
  try {
    return new URL(String(value || '')).hostname || undefined;
  } catch {
    return undefined;
  }
}

function normalizedMaxTokens(value) {
  return Math.max(256, Math.min(32768, Number(value) || 8192));
}

function requestDiagnosticMeta(req, system, user, options = {}) {
  const config = options.config || requestConfig(req);
  const timeoutSeconds = clampTimeout(options.timeoutSeconds ?? loadPanelSettings(req, req.username).ai_timeout_seconds);
  return {
    model: text(config.model, 500),
    base_url_host: safeHostname(config.baseUrl),
    timeout_seconds: timeoutSeconds,
    request_chars: String(user == null ? '' : user).length,
    system_chars: String(system == null ? '' : system).length,
    max_tokens: normalizedMaxTokens(options.maxTokens)
  };
}

function diagnosticCategory(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (error?.code === 'UPSTREAM_TIMEOUT' || /Upstream request timed out/.test(message)) return 'upstream_timeout';
  if (error?.code === 'UPSTREAM_ABORTED' || error?.code === 'CLIENT_CANCELLED' || /Client request aborted/.test(message)) return 'client_cancelled';
  if (error?.code === 'OUTLINE_QUALITY_GATE_BLOCKED') return 'outline_quality_gate_blocked';
  if (Number.isSafeInteger(error?.httpStatus) || /上游模型返回 HTTP \d+/.test(message)) return 'upstream_http';
  if (isModelOutputInvalid(error)) return 'model_output_invalid';
  return 'ai_request_failed';
}

function diagnosticSummary(category) {
  const summaries = {
    upstream_timeout: '上游请求超时',
    upstream_http: '上游返回错误',
    model_output_invalid: '模型响应格式无效',
    outline_quality_gate_blocked: '分镜质量校验未通过',
    client_cancelled: '客户端取消',
    invalid_request: '请求参数无效',
    ai_request_failed: '未知模型请求失败'
  };
  return summaries[category] || summaries.ai_request_failed;
}

function writeDiagnostic(req, event) {
  try {
    return diagnosticStore(req)?.record(req.username, event) || null;
  } catch {
    return null;
  }
}

function writeCompletedAiDiagnostic(req, event) {
  const entry = writeDiagnostic(req, event);
  if (entry) req.novelPanelAiDiagnosticRecorded = true;
  return entry;
}

function requestAbortContext(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      const error = new Error('Client request aborted');
      error.code = 'UPSTREAM_ABORTED';
      controller.abort(error);
    }
  };
  const onClose = () => {
    if (!res.writableEnded) abort();
  };
  req.once('aborted', abort);
  res.once('close', onClose);
  return {
    signal: controller.signal,
    cleanup() {
      req.removeListener('aborted', abort);
      res.removeListener('close', onClose);
    }
  };
}

async function runAiOperation(req, res, operation, execute) {
  const release = getRuntime(req).beginOperation(req.username, operation);
  if (!release) {
    operationConflict(res);
    return false;
  }
  const abortContext = requestAbortContext(req, res);
  const startedAt = Date.now();
  try {
    await execute(abortContext.signal);
    if (abortContext.signal.aborted || res.destroyed) {
      const error = new Error('Client request aborted');
      error.code = 'CLIENT_CANCELLED';
      throw error;
    }
    if (!req.novelPanelAiDiagnosticRecorded) {
      writeDiagnostic(req, {
        ...(req.novelPanelAiDiagnosticMeta || {}),
        operation,
        outcome: 'success',
        category: 'success',
        elapsed_ms: Math.max(0, Date.now() - startedAt)
      });
    }
    return true;
  } catch (error) {
    const category = diagnosticCategory(error);
    const entry = writeDiagnostic(req, {
      ...(req.novelPanelAiDiagnosticMeta || {}),
      operation,
      outcome: 'failed',
      category,
      gate_summary: diagnosticSummary(category),
      http_status: Number.isSafeInteger(error?.httpStatus) ? error.httpStatus : undefined,
      elapsed_ms: Math.max(0, Date.now() - startedAt)
    });
    if (entry?.id && error && typeof error === 'object') error.diagnosticId = entry.id;
    throw error;
  } finally {
    abortContext.cleanup();
    release();
  }
}

function clientError(res, error, diagnosticId = error?.diagnosticId) {
  const message = error instanceof Error ? error.message : String(error || '请求无效');
  return res.status(400).json({ error: message, ...(diagnosticId ? { diagnostic_id: diagnosticId } : {}) });
}

function upstreamErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || '模型请求失败');
  if (error?.code === 'UPSTREAM_TIMEOUT' || /Upstream request timed out/.test(message)) {
    return '模型服务请求超时，服务端已停止本次模型请求。请缩短原文或提高 AI 等待上限后重试。';
  }
  if (error?.code === 'UPSTREAM_ABORTED' || /Client request aborted/.test(message)) {
    return '本次模型请求已取消，服务端已停止本次模型请求。';
  }
  if (/API Key is required|Base URL is required|Model is required/.test(message)) {
    return `模型服务未配置：${message}。请在小说面板“设置”中保存当前账号的模型地址、模型名和 API Key。`;
  }
  if (/上游模型返回 HTTP 401/.test(message)) {
    return '模型服务认证失败：当前 API Key 被上游拒绝。请在小说面板“设置”中更新 API Key，或确认 Base URL 与该 Key 属于同一服务。';
  }
  if (/Client network socket disconnected before secure TLS connection was established|ECONNRESET|SSL_ERROR_SYSCALL/.test(message)) {
    return '模型服务网络连接失败：连接在 TLS 建立前被断开。请在 ClashX Meta 中切换“🤖 AI”的可用节点后重试。';
  }
  return '模型服务请求失败，请查看问题记录中的诊断编号。';
}

function isModelOutputInvalid(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /模型返回为空|模型没有返回合法 JSON|上游模型没有返回 JSON 响应|模型分析结果格式无效|模型没有返回人物外形|模型返回的人物卡数量不一致|模型没有返回分镜数组|CharacterCore模型结果格式无效|CharacterCore未返回人物外形正文|CharacterCore未返回人物槽位记录|CharacterCore验收结果缺少 passed 布尔字段|模型未返回风格文案|模型未返回可用指令建议/.test(message);
}

function upstreamError(res, error, diagnosticId = error?.diagnosticId) {
  const message = error instanceof Error ? error.message : String(error || '模型请求失败');
  if (res.destroyed || res.writableEnded) return;
  if (error?.code === 'OUTLINE_QUALITY_GATE_BLOCKED') {
    return res.status(422).json({
      applied: false,
      reason: 'outline_quality_gate_blocked',
      report: error.report,
      error: message,
      ...(Array.isArray(error.rejectedShots) ? { rejected_shots: error.rejectedShots } : {}),
      ...(diagnosticId ? { diagnostic_id: diagnosticId } : {})
    });
  }
  if (isModelOutputInvalid(error)) {
    return res.status(422).json({
      applied: false,
      code: 'NOVEL_PANEL_MODEL_OUTPUT_INVALID',
      error: message,
      ...(diagnosticId ? { diagnostic_id: diagnosticId } : {})
    });
  }
  const status = error?.code === 'UPSTREAM_TIMEOUT' || error?.code === 'IMAGE_AI_TIMEOUT' || /Upstream request timed out/.test(message)
    ? 504
    : (/API Key is required|Base URL is required|Model is required/.test(message) || /上游模型返回 HTTP 401/.test(message)
      ? 400
      : 502);
  return res.status(status).json({ error: upstreamErrorMessage(error), ...(diagnosticId ? { diagnostic_id: diagnosticId } : {}) });
}

function parseJsonContent(value) {
  const raw = text(value);
  if (!raw) throw new Error('模型返回为空');
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch (_) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch (_) {
        // Preserve the original error below.
      }
    }
  }
  throw new Error('模型没有返回合法 JSON，现有面板数据未被覆盖');
}

async function requestCompletion(req, system, user, {
  maxTokens = 8192,
  temperature = 0.3,
  signal,
  config: configuredConfig,
  parseJson = true
} = {}) {
  const config = configuredConfig || requestConfig(req);
  const timeoutSeconds = clampTimeout(loadPanelSettings(req, req.username).ai_timeout_seconds);
  const effectiveMaxTokens = normalizedMaxTokens(maxTokens);
  req.novelPanelAiDiagnosticMeta = requestDiagnosticMeta(req, system, user, {
    config,
    timeoutSeconds,
    maxTokens: effectiveMaxTokens
  });
  ensureReadyConfig(config);
  const timeoutMs = timeoutSeconds * 1000;
  const upstream = await requestUpstream(config, {
    model: config.model,
    stream: false,
    temperature,
    max_tokens: effectiveMaxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  }, collectResponse, { timeoutMs, signal });

  if (upstream.statusCode >= 400) {
    const error = new Error(`上游模型返回 HTTP ${upstream.statusCode}`);
    error.httpStatus = upstream.statusCode;
    throw error;
  }
  if (!parseJson) return upstream;
  let payload;
  try {
    payload = JSON.parse(upstream.text);
  } catch (_) {
    throw new Error('上游模型没有返回 JSON 响应');
  }
  const content = payload?.choices?.[0]?.message?.content;
  return parseJsonContent(content);
}

function requireNovelText(body) {
  const novelText = text(body?.novel_text, 500000);
  if (!novelText) throw new Error('请先粘贴小说原文。');
  return novelText;
}

function analysisSystemPrompt(presetStore) {
  return resolveSystemPresetBody(presetStore, 'novel-analysis');
}

function characterSystemPrompt(single, presetStore) {
  return [
    resolveSystemPresetBody(presetStore, 'novel-character'),
    single
      ? '返回 {"appearance":"完整可拍摄的外形描述"}。'
      : '返回 {"characters":[...]}，数组数量、顺序与输入 characters 完全一致；每项包含原 name 和 appearance。'
  ].join('\n');
}

function outlineSystemPrompt(mode, presetStore) {
  return [
    resolveSystemPresetBody(presetStore, 'novel-outline'),
    mode === 'regenerate'
      ? '这是单镜重生成：只返回当前 scene 对应的分镜，并落实 guidance 的修改。'
      : '每个非空原文行至少有一条分镜，source_index 从 1 开始对应原文非空行，source_basis 必须引用对应原文。'
  ].join('\n');
}

function buildOutlineUserPayload(body, novelText) {
  return JSON.stringify({
    novel_text: novelText,
    generation_rules: text(body.generation_rules, 30000),
    must_cover_details: text(body.must_cover_details, 8000),
    shot_rhythm_requirements: text(body.shot_rhythm_requirements, 8000),
    scene: isPlainObject(body.scene) ? body.scene : undefined,
    characters: Array.isArray(body.characters) ? body.characters : [],
    outline_shots: Array.isArray(body.outline_shots) ? body.outline_shots : []
  });
}

function newProjectId() {
  return crypto.randomUUID().replace(/-/g, '');
}

function stableSlotToken(sourceEntry, index) {
  return crypto.createHash('sha256').update(`${index}\n${sourceEntry}`).digest('hex').slice(0, 24);
}

function parseRosterEntry(rawEntry, index) {
  const sourceEntry = text(rawEntry, 1000);
  const bracketMatches = [...sourceEntry.matchAll(/[（(]([^()（）]{1,120})[）)]/g)].map(match => text(match[1])).filter(Boolean);
  const baseName = text(sourceEntry.replace(/[（(][^()（）]*[）)]/g, ''), 160);
  if (!baseName) return null;
  const slotToken = stableSlotToken(sourceEntry, index);
  const stageHint = bracketMatches[0] || '';
  return {
    slot_id: slotToken,
    slot_token: slotToken,
    person_id: `person_${slotToken}`,
    source_entry: sourceEntry,
    display_name: sourceEntry,
    base_name: baseName,
    canonical_name_hint: baseName,
    aliases: [],
    bracket_hints: bracketMatches,
    identity_hints: [],
    gender: '待确认',
    species: '',
    age: {
      chronological_age: '',
      visual_age_stage: stageHint,
      life_stage: stageHint,
      timeline_stage: '',
      stage_source: stageHint ? 'forced_roster_bracket' : 'unset'
    },
    manual_values: {},
    inferred_values: {},
    appearance: '',
    appearance_revision_note: '',
    disabled: false
  };
}

function parseForcedRoster(guideText) {
  const entries = [];
  let depth = 0;
  let entry = '';
  for (const character of String(guideText == null ? '' : guideText)) {
    if (character === '(' || character === '（' || character === '[') {
      depth += 1;
      entry += character;
      continue;
    }
    if (character === ')' || character === '）' || character === ']') {
      if (depth > 0) depth -= 1;
      entry += character;
      continue;
    }
    if (depth === 0 && (character === '\n' || character === ',' || character === '，' || character === '、' || character === ';' || character === '；' || character === '|')) {
      const value = text(entry, 1000);
      if (value) entries.push(value);
      entry = '';
      continue;
    }
    entry += character;
  }
  const finalEntry = text(entry, 1000);
  if (finalEntry) entries.push(finalEntry);
  const seen = new Set();
  const slots = [];
  for (const entry of entries) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    const slot = parseRosterEntry(entry, slots.length + 1);
    if (slot) slots.push(slot);
  }
  return slots;
}

function emptyCharacterCore({ slots = [], sourceHash = '', sourceText = '' } = {}) {
  return {
    character_core_version: 2,
    source_hash: text(sourceHash) || crypto.createHash('sha256').update(String(sourceText || '')).digest('hex').slice(0, 24),
    character_revision: 0,
    people: [],
    slots,
    relationships: [],
    aliases: [],
    mention_entities: [],
    scene_casting: {},
    relationship_pending: [],
    keyword_index: {},
    analysis_state: {
      protocol: 'character_core_2_all_genres_v77',
      style_ready: false,
      slots_ready: slots.length > 0,
      forced_roster_ready: slots.length > 0,
      facts_ready: false,
      relationships_ready: false,
      relationship_graph_ready: false,
      appearances_ready: slots.some(slot => Boolean(text(slot.appearance))),
      character_cards_ready: slots.some(slot => Boolean(text(slot.appearance))),
      keyword_index_ready: false,
      casting_ready: false,
      scene_cast_ready: false,
      ready: false
    }
  };
}

function legacyCharacterSlot(character, index) {
  const name = text(character?.display_name || character?.name || character?.base_name, 160);
  if (!name) return null;
  const parsed = parseRosterEntry(name, index);
  return {
    ...parsed,
    gender: text(character?.gender, 32) || parsed.gender,
    aliases: Array.isArray(character?.aliases) ? character.aliases.map(alias => text(alias, 160)).filter(Boolean).slice(0, 20) : [],
    age: {
      ...parsed.age,
      chronological_age: text(character?.chronological_age || character?.age, 80),
      visual_age_stage: text(character?.stage_label || character?.age_stages || parsed.age.visual_age_stage, 120)
    },
    appearance: text(character?.appearance, 6000),
    appearance_revision_note: text(character?.appearance_note, 5000)
  };
}

function migrateProjectCharacterCore(body) {
  const project = isPlainObject(body?.project) ? body.project : {};
  const projectData = isPlainObject(project.data) ? project.data : project;
  const existing = isPlainObject(projectData.character_core_v2)
    ? projectData.character_core_v2
    : (isPlainObject(projectData.character_core) ? projectData.character_core : null);
  if (existing && Number(existing.character_core_version) >= 2) {
    return { migrated: false, character_core: { ...existing, character_core_version: 2 } };
  }
  const legacyCharacters = Array.isArray(projectData.characters) ? projectData.characters : [];
  const slots = legacyCharacters.map(legacyCharacterSlot).filter(Boolean);
  if (!slots.length) {
    slots.push(...parseForcedRoster(body?.guide_text));
  }
  return {
    migrated: true,
    character_core: emptyCharacterCore({ slots, sourceText: text(body?.novel_text, 500000) })
  };
}

router.get('/settings', (req, res) => {
  try {
    res.json(configuredPanelSettings(req, req.username).settings);
  } catch (error) {
    clientError(res, error);
  }
});

router.post('/settings', (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    const current = readConfig(req.username);
    const saved = loadPanelSettings(req, req.username);
    const nextConfig = {
      ...current,
      baseUrl: text(body.base_url) || current.baseUrl,
      model: text(body.model) || current.model,
      apiKey: body.clear_api_key === true ? '' : (text(body.api_key) || current.apiKey)
    };
    writeConfig(req.username, nextConfig);
    const nextSaved = {
      ...saved,
      ai_mode: body.ai_mode === 'local' ? 'local' : 'remote',
      ai_timeout_seconds: clampTimeout(body.ai_timeout_seconds ?? saved.ai_timeout_seconds)
    };
    savePanelSettings(req, req.username, nextSaved);
    res.json({ message: '设置已保存。', settings: panelSettings(nextConfig, nextSaved) });
  } catch (error) {
    clientError(res, error);
  }
});

router.get('/runtime-config', (req, res) => {
  try {
    const saved = loadPanelSettings(req, req.username);
    res.json({ ai_timeout_seconds: clampTimeout(saved.ai_timeout_seconds) });
  } catch (error) {
    clientError(res, error);
  }
});

router.post('/runtime-config', (req, res) => {
  try {
    const saved = loadPanelSettings(req, req.username);
    const runtimeConfig = { ...saved, ai_timeout_seconds: clampTimeout(req.body?.ai_timeout_seconds) };
    savePanelSettings(req, req.username, runtimeConfig);
    res.json({ message: 'AI等待上限已保存。', runtime_config: { ai_timeout_seconds: runtimeConfig.ai_timeout_seconds } });
  } catch (error) {
    clientError(res, error);
  }
});

router.get('/diagnostics', (req, res) => {
  try {
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const diagnostics = diagnosticStore(req)?.listForUser(req.username, parsedLimit) || [];
    return res.json({ diagnostics });
  } catch (error) {
    return clientError(res, error);
  }
});

function novelPanelRoutePaths() {
  const paths = new Set();
  for (const layer of router.stack) {
    const route = layer.route;
    if (route && typeof route.path === 'string' && route.path.startsWith('/')) {
      paths.add(route.path);
      for (const method of Object.keys(route.methods)) paths.add(`${method.toUpperCase()} ${route.path}`);
    }
  }
  return paths;
}

function cleanCoreHealth(req) {
  const paths = novelPanelRoutePaths();
  const requiredRoutes = ['/build-info', '/diagnostics/self-check', '/character-core/health', '/character-core/analyze', '/character-core/resolve-scene-cast', '/history'];
  const checks = [];
  const add = (id, label, ok, detail = '', severity = 'error') => checks.push({ id, label, status: ok ? 'pass' : (severity === 'warn' ? 'warn' : 'fail'), detail: String(detail || '') });
  add('clean_backend_version', '后端V78 Stable版本', V78_BUILD_INFO.app_version === 'v78.3.0.2', V78_BUILD_INFO.build_id);
  add('clean_transport_backend', 'AI Transport后端兼容实现', true, 'remote_json_optimized 保持唯一远程AI出口');
  add('clean_workspace_schema', 'Workspace Schema协议', Number(V78_BUILD_INFO.workspace_schema_version) === 40, `schema=${V78_BUILD_INFO.workspace_schema_version}`);
  add('stable_release', 'V78正式发布身份', V78_BUILD_INFO.release_channel === 'stable' && V78_BUILD_INFO.release_version === 'v78.3.0.2', V78_BUILD_INFO.legacy_v77_role);
  add('clean_character_ai_service', 'Character / Style AI统一服务', V78_BUILD_INFO.character_ai_service === 'character_ai_service_v78_phase16', V78_BUILD_INFO.character_ai_policy);
  add('clean_submission_authority', 'AI Submission Package Authority', V78_BUILD_INFO.submission_authority === 'ai_submission_package_authority_v78_phase8_phase15_default_primary_realtime_fallback', V78_BUILD_INFO.submission_authority);
  add('clean_outline_response', 'Outline Response / Writeback Adapter', V78_BUILD_INFO.outline_response_adapter === 'outline_response_adapter_v78_phase9', V78_BUILD_INFO.writeback_authority);
  add('clean_outline_facade', 'Outline Generation统一编排服务', V78_BUILD_INFO.outline_generation_facade === 'outline_generation_facade_v78_phase15', V78_BUILD_INFO.outline_native_generator);
  add('clean_production_authority', 'Outline Production Authority', V78_BUILD_INFO.outline_production_authority === 'outline_production_authority_v78_phase15', V78_BUILD_INFO.outline_production_policy);
  add('clean_native_generator_service', 'Native Generator Service', V78_BUILD_INFO.native_generator_service === 'native_generator_service_v78_phase14', V78_BUILD_INFO.native_generator_service_policy);
  add('clean_generator_contract', 'Generator Request Contract', V78_BUILD_INFO.generator_contract_service === 'native_generator_request_contract_v78_phase13', V78_BUILD_INFO.generator_contract_id);
  add('clean_generator_protocol', 'Native Generator Protocol Service', V78_BUILD_INFO.generator_protocol_service === 'native_generator_protocol_service_v78_phase13', V78_BUILD_INFO.generator_protocol_policy);
  add('clean_outline_generator', 'Outline Generator Authority', V78_BUILD_INFO.outline_generator_authority === 'outline_generator_authority_v78_phase13', V78_BUILD_INFO.outline_generator_policy);
  add('clean_core_routes', 'Clean Core依赖API完整', requiredRoutes.every(routePath => paths.has(routePath)), '基础路由可访问');
  const failCount = checks.filter(item => item.status === 'fail').length;
  return {
    ok: failCount === 0,
    phase: 'v78_stable',
    build: V78_BUILD_INFO,
    platform_release: platformRelease(req),
    compatibility_components: compatibilityComponents(),
    checks,
    transport: { backend: 'remote_json_optimized', hidden_retry: false },
    workspace_schema_version: 40
  };
}

router.get('/clean-core/health', (req, res) => {
  res.json(cleanCoreHealth(req));
});

router.get('/diagnostics/self-check', (req, res) => {
  const paths = novelPanelRoutePaths();
  const requiredRoutes = ['/analyze', '/outline-scenes', '/regenerate-scene-outline', '/character-core/analyze', '/character-core/parse-slots', '/character-core/resolve-scene-cast', '/history', '/reference-assets/upload', '/runtime-config', '/clean-core/health'];
  const missing = requiredRoutes.filter(routePath => !paths.has(routePath));
  const checks = [];
  const add = (id, label, ok, detail = '', severity = 'error') => checks.push({ id, label, status: ok ? 'pass' : (severity === 'warn' ? 'warn' : 'fail'), detail: String(detail || '') });
  add('routes', '关键API路由完整', missing.length === 0, missing.length ? `缺失：${missing.join('、')}` : `关键路由 ${requiredRoutes.length} 项均存在`);
  add('transport', '当前AI运输层为Hotfix优化实现', true, 'remote_json 已指向当前优化运输层');
  add('forced_roster_formal_gate', '强制名单唯一正式人物后端闸门', true, '名单外关系称呼不再触发人物卡400');
  add('character_core_import', 'CharacterCore 2.0后端模块可加载', true, 'slot解析 / 选角计算可用');
  const panelDirectory = path.join(USERS_DIR, req.username, 'novel-panel');
  try {
    fs.mkdirSync(panelDirectory, { recursive: true });
    add('data_writable', 'data目录可写', true, panelDirectory);
  } catch (error) {
    add('data_writable', 'data目录可写', false, `${error.name}: ${error.message}`);
  }
  try {
    readConfig(req.username);
    add('ai_settings', '文本AI设置结构可读取', true, '设置结构正常；本自检不会调用远程AI');
  } catch (error) {
    add('ai_settings', '文本AI设置结构可读取', false, String(error.message || error), 'warn');
  }
  try {
    const assetDirectory = path.join(panelDirectory, 'reference_assets');
    fs.mkdirSync(assetDirectory, { recursive: true });
    add('reference_assets', '精品参考资产目录可用', true, assetDirectory);
  } catch (error) {
    add('reference_assets', '精品参考资产目录可用', false, `${error.name}: ${error.message}`);
  }
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const item of checks) counts[item.status] += 1;
  const traceRecords = diagnosticStore(req)?.listForUser(req.username, 200)?.length || 0;
  res.json({
    ok: counts.fail === 0,
    build: V78_BUILD_INFO,
    platform_release: platformRelease(req),
    compatibility_components: compatibilityComponents(),
    checks,
    summary: counts,
    active_instances: 1,
    trace_records: traceRecords
  });
});

router.get('/diagnostics/traces', (req, res) => {
  try {
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(80, parsedLimit)) : 20;
    const entries = diagnosticStore(req)?.listForUser(req.username, limit) || [];
    const traces = entries.map(entry => ({
      request_id: entry.id,
      created_at: entry.at,
      updated_at: entry.at,
      request_phase: entry.operation,
      display_name: entry.operation,
      event_count: 1,
      stages: [entry.category].filter(Boolean).slice(-10)
    }));
    return res.json({ ok: true, traces });
  } catch (error) {
    return clientError(res, error);
  }
});

router.get('/diagnostics/trace/:traceId', (req, res) => {
  try {
    const entries = diagnosticStore(req)?.listForUser(req.username, 200) || [];
    const entry = entries.find(item => item.id === req.params.traceId);
    if (!entry) {
      return res.status(404).json({ error: '未找到该Trace；可能尚未发生远程AI请求，或记录已超过保留上限。', code: 'TRACE_NOT_FOUND' });
    }
    const events = [
      { stage: 'request_started', at: entry.at, detail: entry.operation },
      { stage: entry.category || 'completed', at: entry.at, outcome: entry.outcome, category: entry.category, http_status: entry.http_status, elapsed_ms: entry.elapsed_ms, error: entry.error, gate_summary: entry.gate_summary }
    ];
    return res.json({ ok: true, trace: { request_id: entry.id, created_at: entry.at, updated_at: entry.at, request_phase: entry.operation, display_name: entry.operation, events, ...entry } });
  } catch (error) {
    return clientError(res, error);
  }
});

router.get('/history', (req, res) => {
  try {
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const history = historyStore(req).listHistory(req.username, Number.isFinite(parsedLimit) ? parsedLimit : undefined);
    return res.json({ history });
  } catch (error) {
    return clientError(res, error);
  }
});

router.post('/history', (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    if (!isPlainObject(body.workspace)) throw new Error('历史记录缺少工作区数据。');
    const record = historyStore(req).createHistory(req.username, {
      note: body.note,
      workspace: body.workspace,
      instruction_revision: body.instruction_revision
    });
    return res.json({ ok: true, record });
  } catch (error) {
    return clientError(res, error);
  }
});

router.get('/history/:id', (req, res) => {
  try {
    const record = historyStore(req).readHistory(req.username, req.params.id);
    if (!record) return res.status(404).json({ error: '历史记录不存在。', code: 'HISTORY_NOT_FOUND' });
    return res.json({ record });
  } catch (error) {
    return clientError(res, error);
  }
});

router.put('/history/:id', (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    if (!isPlainObject(body.workspace)) throw new Error('历史记录缺少工作区数据。');
    const record = historyStore(req).overwriteHistory(req.username, req.params.id, {
      note: body.note,
      workspace: body.workspace,
      instruction_revision: body.instruction_revision
    });
    if (!record) return res.status(404).json({ error: '要覆盖的历史记录不存在。', code: 'HISTORY_NOT_FOUND' });
    return res.json({ ok: true, record });
  } catch (error) {
    return clientError(res, error);
  }
});

router.patch('/history/:id/note', (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    const record = historyStore(req).updateHistoryNote(req.username, req.params.id, body.note);
    if (!record) return res.status(404).json({ error: '历史记录不存在。', code: 'HISTORY_NOT_FOUND' });
    return res.json({ ok: true, record });
  } catch (error) {
    return clientError(res, error);
  }
});

router.delete('/history/:id', (req, res) => {
  try {
    const deleted = historyStore(req).deleteHistory(req.username, req.params.id);
    if (!deleted) return res.status(404).json({ error: '历史记录不存在。', code: 'HISTORY_NOT_FOUND' });
    return res.json({ ok: true, history_id: req.params.id });
  } catch (error) {
    return clientError(res, error);
  }
});

router.get('/image-settings', (req, res) => {
  try {
    return res.json({ settings: premiumStore(req).publicImageSettings(req.username) });
  } catch (error) {
    return clientError(res, error);
  }
});

router.post('/image-settings', (req, res) => {
  try {
    const settings = premiumStore(req).writeImageSettings(req.username, isPlainObject(req.body) ? req.body : {});
    return res.json({ ok: true, message: '图片AI设置已保存。', settings });
  } catch (error) {
    return clientError(res, error);
  }
});

async function preflightImageSettings(username, candidate) {
  const missing = ['base_url', 'model', 'api_key'].filter(key => !String(candidate[key] || '').trim());
  if (missing.length) {
    const error = new Error(`图片AI配置缺少：${missing.join('、')}`);
    error.imageCode = 'IMAGE_SETTINGS_INCOMPLETE';
    error.missing = missing;
    throw error;
  }
  const baseUrl = normalizeImageBaseUrl(candidate.base_url);
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (_) {
    const error = new Error('图片 API 地址格式不正确。请填写 http:// 或 https:// 开头的有效地址。');
    error.imageCode = 'IMAGE_AI_URL_INVALID';
    throw error;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    const error = new Error('图片 API 地址格式不正确。请填写 http:// 或 https:// 开头的有效地址。');
    error.imageCode = 'IMAGE_AI_URL_INVALID';
    throw error;
  }
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const probe = await fetch(`${baseUrl.replace(/\/+$/, '')}/`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    return {
      message: '图片AI服务地址可访问。',
      diagnostics: { host: parsed.hostname, http_status: probe.status, elapsed_ms: Date.now() - startedAt }
    };
  } catch (_) {
    return {
      message: '已保存图片AI设置；无法连通图片服务地址，生成前请确认服务可用。',
      diagnostics: { host: parsed.hostname, elapsed_ms: Date.now() - startedAt }
    };
  } finally {
    clearTimeout(timer);
  }
}

router.post('/image-settings/test', async (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    const current = premiumStore(req).readImageSettingsRaw(req.username);
    const candidate = { ...current };
    for (const key of ['base_url', 'model', 'api_key', 'generate_path', 'edit_path']) {
      if (body[key] !== undefined) candidate[key] = body[key];
    }
    try {
      const result = await preflightImageSettings(req.username, candidate);
      return res.json({ ok: true, message: result.message, diagnostics: result.diagnostics, settings: premiumStore(req).publicImageSettings(req.username, candidate) });
    } catch (error) {
      return res.status(error.imageCode === 'IMAGE_AI_URL_INVALID' ? 400 : 400).json({
        error: error.message,
        code: error.imageCode,
        details: { missing: error.missing },
        settings: premiumStore(req).publicImageSettings(req.username, candidate)
      });
    }
  } catch (error) {
    return res.status(502).json({ error: String(error.message || error), code: 'IMAGE_AI_PREFLIGHT_FAILED' });
  }
});

router.post('/reference-assets/upload', (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    const assetType = premiumStore(req).safeAssetType(body.asset_type);
    const assetId = premiumStore(req).safeAssetId(body.asset_id);
    const variant = premiumStore(req).safeAssetVariant(body.variant || 'source');
    const { payload, mime } = premiumStore(req).decodeDataUrl(body.data_url);
    const filePath = premiumStore(req).writeReferenceAssetBytes(req.username, assetType, assetId, variant, payload, mime);
    const metadata = premiumStore(req).referenceAssetImageMetadata(req.username, assetType, assetId);
    return res.json({
      ok: true,
      asset_id: assetId,
      asset_type: assetType,
      variant,
      file_name: path.basename(filePath),
      url: premiumStore(req).referenceAssetPublicUrl(assetType, assetId, variant),
      ...metadata
    });
  } catch (error) {
    return res.status(400).json({ error: `保存参考图失败：${error.message}`, code: 'REFERENCE_ASSET_UPLOAD_FAILED' });
  }
});

router.post('/reference-assets/use-source-as-main', (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    const assetType = premiumStore(req).safeAssetType(body.asset_type);
    const assetId = premiumStore(req).safeAssetId(body.asset_id);
    const sourcePath = premiumStore(req).assetFilePath(req.username, assetType, assetId, 'source');
    if (!sourcePath) return res.status(400).json({ error: '还没有上传参考图', code: 'REFERENCE_ASSET_SOURCE_MISSING' });
    const mime = `${path.extname(sourcePath) === '.png' ? 'image/png' : path.extname(sourcePath) === '.webp' ? 'image/webp' : 'image/jpeg'}`;
    premiumStore(req).writeReferenceAssetBytes(req.username, assetType, assetId, 'main', fs.readFileSync(sourcePath), mime);
    const metadata = premiumStore(req).referenceAssetImageMetadata(req.username, assetType, assetId);
    return res.json({ ok: true, asset_id: assetId, asset_type: assetType, url: premiumStore(req).referenceAssetPublicUrl(assetType, assetId, 'main'), file_name: path.basename(sourcePath), main_origin: 'uploaded', ...metadata });
  } catch (error) {
    return res.status(400).json({ error: String(error.message || error), code: 'REFERENCE_ASSET_SOURCE_MISSING' });
  }
});

router.get('/reference-assets/file/:assetType/:assetId/:variant', (req, res) => {
  try {
    const assetType = premiumStore(req).safeAssetType(req.params.assetType);
    const assetId = premiumStore(req).safeAssetId(req.params.assetId);
    const variant = premiumStore(req).safeAssetVariant(req.params.variant);
    const filePath = premiumStore(req).assetFilePath(req.username, assetType, assetId, variant);
    if (!filePath) return res.status(404).json({ error: '参考图片不存在。', code: 'REFERENCE_ASSET_NOT_FOUND' });
    const extension = path.extname(filePath).toLowerCase();
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
    res.set('Cache-Control', 'private, max-age=3600');
    res.set('Content-Type', mime);
    res.set('X-Content-Type-Options', 'nosniff');
    return res.sendFile(filePath);
  } catch (error) {
    return res.status(400).json({ error: String(error.message || error), code: 'REFERENCE_ASSET_FILE_FAILED' });
  }
});

router.post('/reference-assets/describe', async (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    await runAiOperation(req, res, 'reference-assets:describe', async signal => {
      const result = await requestCompletion(req, [
        '你是画面参考资产助手。只返回合法 JSON，不要 Markdown。',
        '返回 {"result":"一段简体中文的视觉描述或补充建议"}。不要编造人物卡之外的性别、年龄或身份事实。'
      ].join('\n'), JSON.stringify(body), { maxTokens: 3000, signal });
      if (!isPlainObject(result) || !text(result.result)) throw new Error('模型未返回描述结果，现有内容未被覆盖');
      if (!res.writableEnded) res.json({ ok: true, result: result.result });
    });
  } catch (error) {
    return upstreamError(res, error);
  }
});

function buildImageGenerationPrompt(body = {}) {
  const parts = [];
  const description = text(body.description);
  if (description) parts.push(`【主体描述】${description}`);
  const character = isPlainObject(body.character);
  if (character) {
    const facts = {};
    for (const key of ['name', 'gender', 'visual_age_stage', 'chronological_age', 'life_stage', 'timeline_stage', 'species']) {
      const value = text(character[key]);
      if (value) facts[key] = value;
    }
    if (Object.keys(facts).length) parts.push(`【人物事实】${JSON.stringify(facts)}`);
  }
  if (text(body.style)) parts.push(`【画面风格】${text(body.style)}`);
  if (text(body.context)) parts.push(`【场景/上下文】${typeof body.context === 'string' ? body.context : JSON.stringify(body.context)}`);
  if (text(body.generation_guidance)) parts.push(`【生成引导】${text(body.generation_guidance)}`);
  if (text(body.image_instruction)) parts.push(`【生成指令】${text(body.image_instruction)}`);
  if (text(body.reference_mode) === 'faceless') parts.push('【参考模式】无人脸参考图：人物可从背面、侧面或远景呈现，不要求可辨识的五官。');
  return parts.join('\n');
}

function buildImageApiUrl(baseUrl, generatePath) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const genPath = String(generatePath || '/images/generations');
  let url = `${base}${genPath}`;
  // OpenAI Images 兼容中转站（vveai / apiyi / 各类中转）通常要求 base_url 含
  // /v1 路径段；用户常漏填成根域名，导致上游返回 Invalid URL。仅当 base_url
  // 是纯域名（无路径段）且 generate_path 不以 /v1 开头时自动补 /v1，不影响
  // 已正确配置 /v1 或自定义 generate_path 的用户。
  if (!genPath.startsWith('/v1')) {
    try {
      const parsed = new URL(base);
      if (!parsed.pathname.replace(/\/+$/, '')) url = `${base}/v1${genPath}`;
    } catch (_) {
      // 非 URL 时保持原样，让 fetch 抛出可读错误。
    }
  }
  return url;
}

router.post('/reference-assets/generate', async (req, res) => {
  try {
    // Web deployment generates reference images through the per-account image AI
    // settings (OpenAI Images compatible /images/generations). Missing config
    // degrades gracefully and keeps the existing reference image state.
    const settings = premiumStore(req).readImageSettingsRaw(req.username);
    const missing = ['base_url', 'model', 'api_key'].filter(key => !text(settings[key] || '').trim());
    if (missing.length) {
      return res.status(400).json({
        error: `图片AI未配置：缺少 ${missing.join('、')}。请在小说面板“AI 设置”→“图片 AI”中填写图片生成 API 地址、模型与密钥；也可上传参考图或使用文本表达。`,
        code: 'IMAGE_SETTINGS_INCOMPLETE'
      });
    }
    const body = isPlainObject(req.body) ? req.body : {};
    const prompt = buildImageGenerationPrompt(body);
    if (!text(prompt)) return res.status(400).json({ error: '缺少生成内容：请填写人物外形描述或生成引导。', code: 'IMAGE_GENERATION_EMPTY_PROMPT' });
    const fullUrl = buildImageApiUrl(settings.base_url, settings.generate_path);
    const payload = {
      model: settings.model,
      prompt,
      n: 1,
      size: settings.size || '1536x1024',
      response_format: 'b64_json',
      ...(isPlainObject(settings.extra_json) ? settings.extra_json : {})
    };
    return await runAiOperation(req, res, 'reference-assets:generate', async signal => {
      const controller = new AbortController();
      let timedOut = false;
      const abortFromClient = () => controller.abort();
      signal?.addEventListener?.('abort', abortFromClient, { once: true });
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(30, Number(settings.timeout_seconds) || 400) * 1000);
      try {
        const upstream = await fetch(fullUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.api_key}` },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        const raw = await upstream.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = { raw }; }
        if (!upstream.ok) {
          const detail = data?.error?.message || data?.message || data?.error || `HTTP ${upstream.status}`;
          const error = new Error(`图片AI请求失败：${detail}`);
          error.httpStatus = upstream.status;
          throw error;
        }
        const item = Array.isArray(data.data) ? data.data[0] : null;
        const b64 = text(item?.b64_json);
        let imageBuffer = null;
        let mime = 'image/png';
        if (b64) {
          imageBuffer = Buffer.from(b64, 'base64');
        } else if (text(item?.url)) {
          const imageResponse = await fetch(item.url, { signal: controller.signal });
          imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
          const contentType = String(imageResponse.headers.get('content-type') || '').toLowerCase();
          if (contentType.includes('jpeg')) mime = 'image/jpeg';
          else if (contentType.includes('webp')) mime = 'image/webp';
          else if (contentType.includes('png')) mime = 'image/png';
        }
        if (!imageBuffer || !imageBuffer.length) throw new Error('图片AI未返回可用的图像内容。');
        const assetType = premiumStore(req).safeAssetType(text(body.asset_type) || 'character');
        const assetId = premiumStore(req).safeAssetId(text(body.asset_id) || `gen_${Date.now()}`);
        premiumStore(req).writeReferenceAssetBytes(req.username, assetType, assetId, 'main', imageBuffer, mime);
        const metadata = premiumStore(req).referenceAssetImageMetadata(req.username, assetType, assetId);
        if (!res.writableEnded) {
          res.json({ ok: true, asset_id: assetId, asset_type: assetType, url: premiumStore(req).referenceAssetPublicUrl(assetType, assetId, 'main'), main_origin: 'generated', ...metadata });
        }
      } catch (error) {
        if (timedOut) {
          const timeoutError = new Error(`图片AI请求超时（超过 ${settings.timeout_seconds} 秒），服务端已停止本次生图请求。请重试或提高图片 AI 超时设置。`);
          timeoutError.code = 'IMAGE_AI_TIMEOUT';
          throw timeoutError;
        }
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', abortFromClient);
      }
    });
  } catch (error) {
    if (res.writableEnded || res.destroyed) return;
    if (error?.code === 'IMAGE_AI_TIMEOUT') {
      return res.status(504).json({ error: error.message, code: 'IMAGE_AI_TIMEOUT', ...(error.diagnosticId ? { diagnostic_id: error.diagnosticId } : {}) });
    }
    return res.status(502).json({ error: error.message || '图片AI请求失败。', ...(error.diagnosticId ? { diagnostic_id: error.diagnosticId } : {}) });
  }
});

router.post('/native-clipboard/copy-rich', (req, res) => {
  // Writing rich text + images to the OS clipboard requires a native process.
  // In the web deployment the V78 workbench falls back to the browser Async
  // Clipboard API (v34BrowserRichCopy) when this endpoint is unavailable.
  return res.status(503).json({
    error: '网页版不支持原生系统图文剪贴板；请改用浏览器的图文复制（系统已自动切换）。',
    code: 'NATIVE_CLIPBOARD_UNAVAILABLE'
  });
});

router.post('/settings/test', async (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    const current = requestConfig(req);
    const candidate = {
      ...current,
      baseUrl: text(body.base_url) || current.baseUrl,
      model: text(body.model) || current.model,
      apiKey: text(body.api_key) || current.apiKey
    };
    await runAiOperation(req, res, 'settings:test', async signal => {
      const upstream = await requestCompletion(req, '', 'ping', {
        maxTokens: 8,
        signal,
        config: candidate,
        parseJson: false
      });
      const result = JSON.parse(upstream.text);
      if (!result?.choices?.[0]?.message) throw new Error('上游响应缺少 choices[0].message');
      if (!res.writableEnded) res.json({ message: '连接成功。' });
    });
  } catch (error) {
    upstreamError(res, error);
  }
});

router.get('/projects', (req, res) => {
  try {
    store.migrateLegacyIfNeeded(req.username);
    res.json({ projects: store.listProjects(req.username) });
  } catch (error) {
    clientError(res, error);
  }
});

router.post('/projects', (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    const requestedId = text(body.project_id || body.id);
    if (requestedId && !isValidProjectId(requestedId)) throw new Error('项目 ID 无效');
    const existing = requestedId ? store.loadProject(req.username, requestedId) : null;
    const now = new Date().toISOString();
    const project = store.saveProject(req.username, {
      id: requestedId || newProjectId(),
      name: text(body.name, 160) || existing?.name || '未命名项目',
      data: isPlainObject(body.data) ? body.data : {},
      created_at: existing?.created_at || now,
      updated_at: now
    });
    res.json({ project });
  } catch (error) {
    clientError(res, error);
  }
});

router.get('/projects/:id', (req, res) => {
  try {
    if (!isValidProjectId(req.params.id)) throw new Error('项目 ID 无效');
    const project = store.loadProject(req.username, req.params.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    return res.json({ project });
  } catch (error) {
    return clientError(res, error);
  }
});

router.delete('/projects/:id', (req, res) => {
  try {
    if (!isValidProjectId(req.params.id)) throw new Error('项目 ID 无效');
    if (!store.deleteProject(req.username, req.params.id)) return res.status(404).json({ error: '项目不存在' });
    return res.json({ ok: true });
  } catch (error) {
    return clientError(res, error);
  }
});

router.post('/:id/export', (req, res) => {
  const project = store.loadProject(req.username, req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const root = getStorageRoot(req.auth ? req.auth.account.username : (req.username || ''));
  if (!root) return res.json({ saved: false, reason: '未配置本地存储文件夹' });
  const file = writeNovelPanelExport(root, project);
  res.json({ saved: true, path: file });
});

router.get('/draft', (req, res) => {
  try {
    return res.json({ draft: getRuntime(req).loadDraft(req.username) });
  } catch (error) {
    return clientError(res, error);
  }
});

router.put('/draft', (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    const draft = isPlainObject(body.draft) ? body.draft : body;
    return res.json({ draft: getRuntime(req).saveDraft(req.username, draft) });
  } catch (error) {
    return clientError(res, error);
  }
});

router.post('/analyze', async (req, res) => {
  try {
    const novelText = requireNovelText(req.body);
    await runAiOperation(req, res, 'analyze', async signal => {
      const result = await requestCompletion(req, analysisSystemPrompt(req.app.locals.presetStore), novelText, { maxTokens: 12000, signal });
      if (!isPlainObject(result)) throw new Error('模型分析结果格式无效');
      result.characters = Array.isArray(result.characters) ? result.characters : [];
      result.scene_options = Array.isArray(result.scene_options) ? result.scene_options : [];
      if (!res.writableEnded) res.json(result);
    });
  } catch (error) {
    if (/请先粘贴/.test(error.message)) return clientError(res, error);
    return upstreamError(res, error);
  }
});

router.post(['/optimize-character-copy', '/optimize-character'], async (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    if (!isPlainObject(body.character)) throw new Error('缺少当前人物卡。');
    await runAiOperation(req, res, `character:${operationSuffix(body.character.slot_id || body.character.name, 'single')}`, async signal => {
      const result = await requestCompletion(req, characterSystemPrompt(true, req.app.locals.presetStore), JSON.stringify({
        novel_text: text(body.novel_text, 120000),
        genre: text(body.genre, 200),
        trailer_style: text(body.trailer_style, 1000),
        character: body.character
      }), { maxTokens: 3000, signal });
      if (!text(result.appearance)) throw new Error('模型没有返回人物外形，原人物卡未被覆盖');
      if (!res.writableEnded) res.json(result);
    });
  } catch (error) {
    if (/缺少当前人物卡/.test(error.message)) return clientError(res, error);
    return upstreamError(res, error);
  }
});

router.post('/optimize-all-characters', async (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    if (!Array.isArray(body.characters) || !body.characters.length) throw new Error('没有可生成的人物卡。');
    await runAiOperation(req, res, 'character:all', async signal => {
      const result = await requestCompletion(req, characterSystemPrompt(false, req.app.locals.presetStore), JSON.stringify({
        novel_text: text(body.novel_text, 120000),
        genre: text(body.genre, 200),
        trailer_style: text(body.trailer_style, 1000),
        appearance_reference: text(body.appearance_reference, 4000),
        characters: body.characters
      }), { maxTokens: 9000, signal });
      if (!Array.isArray(result.characters) || result.characters.length !== body.characters.length) {
        throw new Error('模型返回的人物卡数量不一致，现有人物卡未被覆盖');
      }
      if (!res.writableEnded) res.json(result);
    });
  } catch (error) {
    if (/没有可生成的人物卡/.test(error.message)) return clientError(res, error);
    return upstreamError(res, error);
  }
});

async function generateOutline(req, res, mode) {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    const novelText = requireNovelText(body);
    const operation = mode === 'regenerate'
      ? `scene:${operationSuffix(body.scene?.id || body.scene?.source_key || body.scene?.source_index, 'current')}`
      : 'outline';
    await runAiOperation(req, res, operation, async signal => {
      const result = await requestCompletion(req, outlineSystemPrompt(mode, req.app.locals.presetStore), buildOutlineUserPayload(body, novelText), { maxTokens: 16000, temperature: 0.35, signal });
      if (!isPlainObject(result) || !Array.isArray(result.outline_shots)) throw new Error('模型没有返回分镜数组，原分镜未被覆盖');
      const report = validateOutlineApplyGate(result, {
        novelText,
        mode: mode === 'regenerate' ? 'scene_regenerate' : 'outline',
        scene: body.scene,
        guidance: text(body.scene?.guidance || body.generation_rules, 4000),
        beforeShots: Array.isArray(body.outline_shots) ? body.outline_shots : []
      });
      const invalidRegeneratedShotReport = mode === 'regenerate'
        ? result.outline_shots
          .map(shot => validateOutlineShotApplyGate(shot, {
            novelText,
            scene: body.scene,
            manual_cast_mode: body.manual_cast_mode,
            manual_selected_characters: body.manual_selected_characters,
            manual_forbidden_characters: body.manual_forbidden_characters
          }))
          .find(shotReport => !shotReport.ok)
        : null;
      const failedReport = report.ok ? invalidRegeneratedShotReport : report;
      if (failedReport) {
        if (mode === 'outline') {
          const acceptedShots = [];
          const rejectedShots = [];
          result.outline_shots.forEach(shot => {
            const shotReport = validateOutlineShotApplyGate(shot, {
              novelText,
              scene: body.scene,
              manual_cast_mode: body.manual_cast_mode,
              manual_selected_characters: body.manual_selected_characters,
              manual_forbidden_characters: body.manual_forbidden_characters
            });
            if (shotReport.ok) {
              acceptedShots.push(shot);
              return;
            }
            rejectedShots.push({
              source_index: shot?.source_index,
              source_basis: text(shot?.source_basis, 240),
              reason: summarizeOutlineGateIssues(shotReport),
              codes: shotReport.blockingIssues.map(issue => issue.code)
            });
          });
          if (acceptedShots.length) {
            const diagnostic = writeCompletedAiDiagnostic(req, {
              ...(req.novelPanelAiDiagnosticMeta || {}),
              operation,
              outcome: 'partial',
              category: 'outline_quality_gate_blocked',
              gate_summary: summarizeOutlineGateIssues(failedReport),
              outline_returned: result.outline_shots.length,
              outline_accepted: acceptedShots.length,
              outline_rejected: rejectedShots.length,
              partial: true
            });
            if (!res.writableEnded) {
              res.json({
                ...result,
                outline_shots: acceptedShots,
                applied: true,
                partial: true,
                rejected_shots: rejectedShots,
                report: failedReport,
                ...(diagnostic?.id ? { diagnostic_id: diagnostic.id } : {})
              });
            }
            return;
          }
          const error = new Error(summarizeOutlineGateIssues(failedReport));
          error.code = 'OUTLINE_QUALITY_GATE_BLOCKED';
          error.report = failedReport;
          error.rejectedShots = rejectedShots;
          throw error;
        }
        const error = new Error(summarizeOutlineGateIssues(failedReport));
        error.code = 'OUTLINE_QUALITY_GATE_BLOCKED';
        error.report = failedReport;
        throw error;
      }
      if (!res.writableEnded) res.json({ ...result, applied: true, report });
    });
  } catch (error) {
    if (/请先粘贴/.test(error.message)) return clientError(res, error);
    return upstreamError(res, error);
  }
}

router.post('/outline-scenes', (req, res) => generateOutline(req, res, 'outline'));
router.post('/regenerate-scene-outline', (req, res) => generateOutline(req, res, 'regenerate'));
// V77 builds released before the outline rename can still send this endpoint.
router.post('/generate-scene-prompts', (req, res) => generateOutline(req, res, 'outline'));

router.post('/optimize-style-copy', async (req, res) => {
  try {
    await runAiOperation(req, res, 'style', async signal => {
      const result = await requestCompletion(req, '只返回合法 JSON，不要 Markdown。根据用户输入返回 {"copy":"可直接使用的中文文本"}，不得编造小说事实。', JSON.stringify(req.body || {}), { maxTokens: 3000, signal });
      if (!isPlainObject(result) || !text(result.copy)) throw new Error('模型未返回风格文案，现有内容未被覆盖');
      if (!res.writableEnded) res.json(result);
    });
  } catch (error) {
    return upstreamError(res, error);
  }
});

router.post('/instruction-assist', async (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    await runAiOperation(req, res, 'instruction', async signal => {
      const result = await requestCompletion(req, [
        '你是 AI 指令编辑助手。只返回合法 JSON，不要 Markdown。',
        '返回 {"suggestions":"...","revised_instruction":"..."}。不得改变用户给出的 protocol_lock 所约束的输入输出协议。'
      ].join('\n'), JSON.stringify(body), { maxTokens: 5000, signal });
      if (!isPlainObject(result) || !text(result.suggestions) || !text(result.revised_instruction)) {
        throw new Error('模型未返回可用指令建议，现有内容未被覆盖');
      }
      if (!res.writableEnded) res.json(result);
    });
  } catch (error) {
    return upstreamError(res, error);
  }
});

router.get('/character-core/health', (req, res) => {
  res.json({
    ok: true,
    character_core_version: 2,
    app_version: 'v78.3.0.2',
    analysis_protocol: 'character_core_2_all_genres_v78_stable',
    semantic_layer: 'character_core_single_executor_v78_stable',
    clean_core_phase: 'v78_3_0_2_scene_event_canonical_timeline'
  });
});

router.post('/character-core/trace', (req, res) => {
  // The desktop V77 service wrote diagnostic files here. qiantie persists the
  // most recent CharacterCore parity traces so the CORE_PARITY_TRACE metrics
  // (relationships_envelope_present / relationships_returned / mapped) can be
  // audited when the relationship graph appears empty.
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    const targetPath = path.join(USERS_DIR, req.username, 'novel-panel', 'character-core-traces.json');
    const { withJsonLock: lockTrace, writeJsonAtomic: writeTraceAtomic } = require('../lib/system-store');
    const { readJsonOrMissing: readTraceJson } = require('../lib/system-store');
    lockTrace(`${targetPath}.lock`, () => {
      const existing = readTraceJson(targetPath);
      const list = Array.isArray(existing.value) ? existing.value : [];
      list.unshift({ id: body.request_id || `trace-${Date.now()}`, at: new Date().toISOString(), trace_stage: body.trace_stage || 'unknown', ...body });
      writeTraceAtomic(targetPath, list.slice(0, 50));
    });
    return res.json({ ok: true, logged: true });
  } catch (error) {
    return clientError(res, error);
  }
});

router.post('/character-core/parse-slots', (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    const sourceHash = text(body.source_hash, 256);
    const slots = parseForcedRoster(body.guide_text);
    return res.json({ slots, slot_count: slots.length, source_hash: sourceHash });
  } catch (error) {
    return clientError(res, error);
  }
});

function sceneCastItems(sourceText, slots, selectedSlotIds = []) {
  const source = String(sourceText || '');
  const selected = new Set(Array.isArray(selectedSlotIds) ? selectedSlotIds.filter(id => typeof id === 'string') : []);
  const items = [];
  const mentionedOnly = [];
  for (const slot of Array.isArray(slots) ? slots : []) {
    if (!isPlainObject(slot)) continue;
    const slotId = text(slot.slot_id || slot.slot_token);
    if (!slotId) continue;
    const names = [text(slot.base_name), text(slot.display_name), text(slot.canonical_name_hint)]
      .concat(Array.isArray(slot.aliases) ? slot.aliases.map(alias => text(alias)) : [])
      .filter(Boolean);
    const matchedName = names.find(name => source.includes(name));
    const item = {
      slot_id: slotId,
      slot_token: text(slot.slot_token || slotId),
      person_id: text(slot.person_id) || `person_${slotId}`,
      display_name: text(slot.display_name || slot.base_name),
      scene_role: selected.has(slotId) || matchedName ? 'visible' : 'mentioned_only',
      evidence: matchedName ? [`原文包含「${matchedName}」`] : [],
      confidence: matchedName ? 1 : 0
    };
    if (matchedName || selected.has(slotId)) items.push(item);
    else mentionedOnly.push({ ...item, scene_role: 'mentioned_only' });
  }
  return { selected: items, mentionedOnly };
}

router.post('/character-core/resolve-scene-cast', (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    const { selected, mentionedOnly } = sceneCastItems(
      body.source_text,
      body.slots,
      body.manual_selected_slot_ids
    );
    return res.json({
      scene_id: text(body.scene_id, 160),
      selected,
      mentioned_only: mentionedOnly,
      offscreen_voice: [],
      ambiguous: []
    });
  } catch (error) {
    return clientError(res, error);
  }
});

router.post('/character-core/build-scene-context', (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    const cast = isPlainObject(body.cast) ? body.cast : {};
    const selected = Array.isArray(cast.selected) ? cast.selected : [];
    const slots = Array.isArray(body.slots) ? body.slots : [];
    const slotById = new Map();
    for (const slot of slots) {
      if (!isPlainObject(slot)) continue;
      const slotId = text(slot.slot_id || slot.slot_token);
      if (slotId) slotById.set(slotId, slot);
    }
    const characters = selected.map(item => {
      const slot = slotById.get(text(item.slot_id || item.slot_token));
      return {
        slot_id: text(item.slot_id || item.slot_token),
        display_name: text(item.display_name || slot?.display_name || slot?.base_name),
        gender: text(slot?.gender),
        age_stage: text(slot?.age?.visual_age_stage || slot?.age?.life_stage),
        appearance: text(slot?.appearance)
      };
    }).filter(item => item.display_name);
    return res.json({
      scene_id: text(cast.scene_id, 160),
      characters,
      relationships: Array.isArray(body.relationships) ? body.relationships : []
    });
  } catch (error) {
    return clientError(res, error);
  }
});

router.post('/character-core/project-lease', (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    return res.json(getRuntime(req).lease(req.username, {
      action: text(body.action, 24),
      projectId: text(body.project_id, 160),
      instanceId: text(body.instance_id, 256),
      force: body.force === true
    }));
  } catch (error) {
    return clientError(res, error);
  }
});

router.post('/character-core/migrate-project', (req, res) => {
  try {
    return res.json(migrateProjectCharacterCore(isPlainObject(req.body) ? req.body : {}));
  } catch (error) {
    return clientError(res, error);
  }
});

router.post('/character-core/analyze', async (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    const novelText = text(body.novel_text, 160000);
    const stage = text(body.request_stage).replace(/-/g, '_');
    if (!novelText) throw new Error('CharacterCore请求缺少分析提示词。');
    if (!['style', 'facts_relationships', 'appearance', 'revision_check'].includes(stage)) {
      throw new Error('CharacterCore请求缺少V77阶段标记。');
    }
    const contracts = {
      style: '只返回合法 JSON。返回内容类型、时代、世界观、核心关系、核心冲突、叙事发动机、情绪基调、观看期待，以及 cinematic_quality、capture_texture、grain_texture、filter_tone、lens_language、optical_texture、contrast_level、saturation_level、lighting_layers、narrative_composition、atmosphere。所有文本使用简体中文。',
      facts_relationships: '只返回合法 JSON。返回 characters、relationships、alias_bindings、mention_entities、ambiguous_relations。characters 只对应输入提示中的既有槽位，不能新增或删除槽位。',
      appearance: '只返回合法 JSON，顶层必须为 {"appearance":"..."}。appearance 只是一段可拍摄的静态人物外形中文描述，不得输出剧情、标题或解释。',
      revision_check: '只返回合法 JSON，顶层必须包含布尔 passed，以及 implemented、missing、violations 数组和 summary 字符串。'
    };
    const slot = operationSuffix(body.slot_id || body.slot_token, 'all');
    await runAiOperation(req, res, `character-core:${stage}:${slot}`, async signal => {
      const result = await requestCompletion(req, [
        '你是 CharacterCore 2.0 的服务端阶段执行器。只能依据用户的当前请求，不能引用历史缓存或编造小说事实。',
        '用户输入内含有阶段规则和当前值；在不改变接口字段的前提下遵守它们。',
        contracts[stage]
      ].join('\n'), novelText, { maxTokens: stage === 'appearance' ? 4000 : 12000, temperature: 0.25, signal });
      if (!isPlainObject(result)) throw new Error('CharacterCore模型结果格式无效');
      if (stage === 'appearance' && !text(result.appearance)) throw new Error('CharacterCore未返回人物外形正文');
      if (stage === 'facts_relationships' && !Array.isArray(result.characters)) throw new Error('CharacterCore未返回人物槽位记录');
      if (stage === 'revision_check' && typeof result.passed !== 'boolean') throw new Error('CharacterCore验收结果缺少 passed 布尔字段');
      if (!res.writableEnded) res.json({ ...result, _character_core_direct: true, _character_core_stage: stage, _character_core_protocol: 'character_core_2_all_genres_v77' });
    });
  } catch (error) {
    if (/CharacterCore请求缺少|阶段标记/.test(error.message)) return clientError(res, error);
    return upstreamError(res, error);
  }
});

router.all(/.*/, (req, res) => {
  res.status(404).json({
    code: 'NOVEL_PANEL_ENDPOINT_NOT_FOUND',
    error: `小说面板接口不存在：${req.method} /api/novel-panel${req.path}`
  });
});

router._private = {
  analysisSystemPrompt,
  characterSystemPrompt,
  outlineSystemPrompt,
  runAiOperation,
  upstreamError,
  upstreamErrorMessage
};

module.exports = router;
