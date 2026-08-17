const crypto = require('node:crypto');
const express = require('express');

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
const {
  validateOutlineApplyGate,
  validateOutlineShotApplyGate,
  summarizeOutlineGateIssues
} = require('../lib/novel-panel/quality-gate');
const { resolveSystemPresetBody } = require('../lib/system-preset-catalog');

const router = express.Router();
const store = createNovelPanelStore({ usersDir: USERS_DIR });
const runtime = createNovelPanelRuntime({ usersDir: USERS_DIR });
const DEFAULT_TIMEOUT_SECONDS = 400;
const MIN_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 600;

router.get('/build-info', (req, res) => {
  res.json({ app_version: 'v77-hotfix26', build_id: 'v77-hotfix26-style-reuse-r1' });
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

function loadPanelSettings(username) {
  try {
    const result = require('../lib/system-store').readJsonOrMissing(store.settingsPath(username));
    return result.found && isPlainObject(result.value) ? result.value : {};
  } catch {
    throw new Error('小说面板设置文件无法读取');
  }
}

function savePanelSettings(username, value) {
  const { writeJsonAtomic } = require('../lib/system-store');
  writeJsonAtomic(store.settingsPath(username), value);
}

function configuredPanelSettings(username) {
  const config = readConfig(username);
  const saved = loadPanelSettings(username);
  return { config, saved, settings: panelSettings(config, saved) };
}

function getRuntime(req) {
  return req.app?.locals?.novelPanelRuntime || runtime;
}

function diagnosticStore(req) {
  return req.app?.locals?.novelPanelAiDiagnosticStore || null;
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
  const timeoutSeconds = clampTimeout(options.timeoutSeconds ?? loadPanelSettings(req.username).ai_timeout_seconds);
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
  const status = error?.code === 'UPSTREAM_TIMEOUT' || /Upstream request timed out/.test(message)
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
  const timeoutSeconds = clampTimeout(loadPanelSettings(req.username).ai_timeout_seconds);
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
    res.json(configuredPanelSettings(req.username).settings);
  } catch (error) {
    clientError(res, error);
  }
});

router.post('/settings', (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    const current = readConfig(req.username);
    const saved = loadPanelSettings(req.username);
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
    savePanelSettings(req.username, nextSaved);
    res.json({ message: '设置已保存。', settings: panelSettings(nextConfig, nextSaved) });
  } catch (error) {
    clientError(res, error);
  }
});

router.get('/runtime-config', (req, res) => {
  try {
    const saved = loadPanelSettings(req.username);
    res.json({ ai_timeout_seconds: clampTimeout(saved.ai_timeout_seconds) });
  } catch (error) {
    clientError(res, error);
  }
});

router.post('/runtime-config', (req, res) => {
  try {
    const saved = loadPanelSettings(req.username);
    const runtimeConfig = { ...saved, ai_timeout_seconds: clampTimeout(req.body?.ai_timeout_seconds) };
    savePanelSettings(req.username, runtimeConfig);
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
    app_version: 'v77-hotfix26',
    analysis_protocol: 'character_core_2_all_genres_v77',
    semantic_layer: 'character_core_single_executor_v77_hotfix26_style_reuse'
  });
});

router.post('/character-core/trace', (req, res) => {
  // The desktop V77 service wrote diagnostic files here. qiantie intentionally
  // keeps this request ephemeral so per-user project storage contains no traces.
  res.json({ ok: true, logged: false });
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
