const state = {
  config: null,
  tasks: [],
  selectedId: "",
  selectedIds: new Set(),
  sensitiveProcessingIds: new Set(),
  pendingRuleSuggestions: null,
  pendingOpeningItem: null,
  activeProcessJobId: "",
  taskDate: "",
};

const DEFAULT_COLUMN_ORDER = "书籍ID,书名,推荐理由,男女频,标签,评级";
const WORK_FORM_STORAGE_KEY = "batchRewrite.workForm.v1";
const LEGACY_WORK_INPUT_SAMPLE_PREFIX = "7674515088685943832\t";
const API_ROOT = "/api/batch-rewrite";
const PLATFORM_API_TIMEOUT_MS = 15000;
const PER_BOOK_MATERIAL_LIMIT = 8;
const PROCESS_JOB_TIMEOUT_MS = 10 * 60 * 1000;
const REWRITE_METHOD_OPTIONS = [
  { id: "", name: "自动轮换" },
  { id: "high_imitation", name: "高仿文章库" },
  { id: "opening_instruction", name: "爆款开头词库" },
  { id: "instruction", name: "批量改文指令库" },
];
let workFormSaveTimer = null;

const $ = (id) => document.getElementById(id);

document.documentElement.dataset.theme = new URLSearchParams(window.location.search).get('theme') === 'light' ? 'light' : 'dark';
window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || event.data?.type !== 'qiantie-theme-sync') return;
  document.documentElement.dataset.theme = event.data.theme === 'light' ? 'light' : 'dark';
});

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function numberValue(id, fallback) {
  const value = Number($(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function materialJieyaValue(value) {
  const count = Math.round(Number(value));
  return Number.isFinite(count) ? Math.max(0, Math.min(PER_BOOK_MATERIAL_LIMIT, count)) : 4;
}

function parseJsonInput(id, fallback) {
  const text = String($(id)?.value || '').trim();
  if (!text) return fallback;
  try { return JSON.parse(text); } catch (_) { throw new Error(`${id === 'webProfilesJson' ? '上传配置档' : '版本绑定'} 不是有效 JSON`); }
}

function syncGunpingMaterialCount() {
  const jieya = materialJieyaValue($("webJieyaNum")?.value);
  if ($("webJieyaNum")) $("webJieyaNum").value = jieya;
  if ($("webGunpingNum")) $("webGunpingNum").value = PER_BOOK_MATERIAL_LIMIT - jieya;
}

async function api(path, options = {}) {
  const legacyPath = String(path || "").replace(/^\/api/, "");
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = localStorage.getItem("auth_token") || "";
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${API_ROOT}${legacyPath}`, { headers, ...options });
  } catch (error) {
    reportBatchIssue("network", path, error.message || "网络请求失败");
    throw error;
  }
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    // 兼容本工作台接口使用的 { error } 结构，避免把可操作的原因吞成“HTTP 400”。
    const error = new Error(data.error || data.detail || data.message || data.raw || `HTTP ${response.status}`);
    reportBatchIssue("response", path, error.message, response.status, options.method || "GET");
    throw error;
  }
  return data;
}

// External 121 checks must always settle so the UI cannot remain in a loading state.
async function novelFetchPlatformApi(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = localStorage.getItem("auth_token") || "";
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), PLATFORM_API_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetch(path, { ...options, headers, signal: controller.signal });
    } catch (error) {
      const message = error?.name === "AbortError" ? "验证请求超时，请检查网络后重试" : (error?.message || "网络请求失败");
      reportBatchIssue("network", path, message, undefined, options.method || "GET");
      throw new Error(message);
    }
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
    if (!response.ok) {
      const message = data.error || `HTTP ${response.status}`;
      reportBatchIssue("response", path, message, response.status, options.method || "GET");
      throw new Error(message);
    }
    return data;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function reportBatchIssue(kind, path, message, status, method) {
  const section = String(path || "").includes("web-submit") ? "submit"
    : String(path || "").includes("rules") ? "rules"
      : String(path || "").includes("process") ? "processing" : "api";
  const token = localStorage.getItem("auth_token") || "";
  const payload = JSON.stringify({
    kind: `batch-rewrite.${section}.${kind}`,
    message: String(message || "小说获取操作失败").slice(0, 4000),
    source: "小说获取",
    path: `${API_ROOT}${String(path || "")}`,
    method: method || "GET",
    status: Number.isInteger(status) ? status : undefined
  });
  void fetch("/api/client-errors", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: payload, keepalive: true }).catch(() => {});
}

function activateTab(name) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === name);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === name);
  });
}

function visiblePlatforms() {
  const items = state.config?.platforms || [];
  return items.filter((item) => item.visible !== false);
}

function renderOptions(select, items, valueKey = "id", labelKey = "name") {
  select.innerHTML = "";
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item[valueKey];
    option.textContent = item[labelKey];
    select.appendChild(option);
  }
}

function collectWorkFormState() {
  return {
    platform_id: $("platformSelect")?.value || "",
    input_text: $("inputText")?.value || "",
    selected_versions: selectedProcessVersions(),
    ai_slot_methods: processAiMethods(),
    sensitive_ai_enabled: sensitiveAiProcessEnabled(),
    updated_at: new Date().toISOString(),
  };
}

function saveWorkFormState() {
  const formState = collectWorkFormState();
  try {
    localStorage.setItem(WORK_FORM_STORAGE_KEY, JSON.stringify(formState));
  } catch {
    // localStorage may be unavailable in some locked-down browsers.
  }
  clearTimeout(workFormSaveTimer);
  workFormSaveTimer = setTimeout(() => {
    api("/api/work-form", {
      method: "POST",
      body: JSON.stringify({ state: formState }),
    }).catch(() => {});
  }, 800);
}

async function saveWorkFormStateNow() {
  const formState = collectWorkFormState();
  try {
    localStorage.setItem(WORK_FORM_STORAGE_KEY, JSON.stringify(formState));
  } catch {
    // ignore local save failure
  }
  await api("/api/work-form", {
    method: "POST",
    body: JSON.stringify({ state: formState }),
  }).catch(() => {});
}

function newerWorkFormState(localState, serverState) {
  if (!localState) return serverState || null;
  if (!serverState) return localState;
  const localTime = Date.parse(localState.updated_at || "") || 0;
  const serverTime = Date.parse(serverState.updated_at || "") || 0;
  return localTime >= serverTime ? localState : serverState;
}

function removeLegacyWorkInputSample(formState) {
  if (!formState || typeof formState !== "object") return { formState, removed: false };
  if (typeof formState.input_text !== "string" || !formState.input_text.startsWith(LEGACY_WORK_INPUT_SAMPLE_PREFIX)) {
    return { formState, removed: false };
  }
  return { formState: { ...formState, input_text: "" }, removed: true };
}

function restoreWorkFormState() {
  let localState = null;
  try {
    localState = JSON.parse(localStorage.getItem(WORK_FORM_STORAGE_KEY) || "null");
  } catch {
    localState = null;
  }
  const local = removeLegacyWorkInputSample(localState);
  const server = removeLegacyWorkInputSample(state.config?.work_form || null);
  const saved = newerWorkFormState(local.formState, server.formState);
  if (!saved || typeof saved !== "object") return;
  const platformSelect = $("platformSelect");
  if (saved.platform_id && [...platformSelect.options].some((option) => option.value === String(saved.platform_id))) {
    platformSelect.value = String(saved.platform_id);
  }
  if (typeof saved.input_text === "string") $("inputText").value = saved.input_text;
  const selected = new Set(asArray(saved.selected_versions).map(version => String(version).toLowerCase()));
  if (selected.size) document.querySelectorAll('.process-version').forEach(input => { input.checked = selected.has(input.value); });
  for (let index = 1; index <= 5; index += 1) {
    const select = $(`processAiMethod${index}`);
    if (select) select.value = saved.ai_slot_methods?.[`ai${index}`] || '';
  }
  if (typeof saved.sensitive_ai_enabled === "boolean" && $("sensitiveAiProcessEnabled")) {
    $("sensitiveAiProcessEnabled").checked = saved.sensitive_ai_enabled;
  }
  if (local.removed || server.removed) window.setTimeout(() => { saveWorkFormStateNow(); }, 0);
  updateVersionConfigSummary();
}

function bindWorkFormPersistence() {
  for (const id of ["platformSelect"]) {
    const element = $(id);
    if (element) element.addEventListener("change", saveWorkFormState);
  }
  for (const id of ["inputText"]) {
    const element = $(id);
    if (element) element.addEventListener("input", saveWorkFormState);
  }
  const sensitiveAiToggle = $("sensitiveAiProcessEnabled");
  if (sensitiveAiToggle) sensitiveAiToggle.addEventListener("change", saveWorkFormState);
  document.querySelectorAll('.process-version, [id^="processAiMethod"]').forEach(element => element.addEventListener('change', () => {
    saveWorkFormState();
    updateVersionConfigSummary();
  }));
}

function presetOptions() {
  const presets = state.config?.app_config?.ai_presets || [];
  return [
    { id: "__current__", name: "当前AI配置" },
    ...presets.map((item) => ({ id: item.id, name: `${item.name || item.id} (${item.model || "未填模型"})` })),
  ];
}

function processAiMethods() {
  const result = {};
  for (let index = 1; index <= 5; index += 1) {
    const element = $(`processAiMethod${index}`);
    const value = element?.value || "";
    if (value) result[`ai${index}`] = value;
  }
  return result;
}

function selectedProcessVersions() {
  return [...document.querySelectorAll('.process-version:checked')].map(input => input.value);
}

function updateVersionConfigSummary() {
  const summary = $("versionConfigSummary");
  if (!summary) return;
  const versions = selectedProcessVersions();
  summary.textContent = versions.length
    ? versions.map(version => version === "original" ? "原文" : version.toUpperCase()).join("、")
    : "未选择版本";
}

function openVersionConfigCard() {
  const dialog = $("versionConfigCard");
  if (!dialog) return;
  renderVersionPromptConfig();
  updateVersionConfigSummary();
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function renderVersionPromptConfig() {
  const rewrite = state.config?.app_config?.rewrite || {};
  const fields = {
    versionConfigRewritePrompt: rewrite.prompt || "",
    versionConfigProcessingRulePrompt: rewrite.processing_rule_prompt || "",
    versionConfigKnowledgeUsagePrompt: state.config?.knowledge?.usage_prompt || "",
  };
  for (const [id, value] of Object.entries(fields)) {
    const element = $(id);
    if (element) element.value = value;
  }
}

function syncVersionPromptConfigToForm() {
  const pairs = [
    ["versionConfigRewritePrompt", "rewritePrompt"],
    ["versionConfigProcessingRulePrompt", "processingRulePrompt"],
    ["versionConfigKnowledgeUsagePrompt", "knowledgeUsagePrompt"],
  ];
  for (const [sourceId, targetId] of pairs) {
    const source = $(sourceId);
    const target = $(targetId);
    if (source && target) target.value = source.value;
  }
}

function closeVersionConfigCard() {
  const dialog = $("versionConfigCard");
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function renderConfig() {
  const appCfg = state.config.app_config || {};
  ensureKnowledgeConfig();
  ensureSensitiveConfig();
  ensureWebSubmitConfig();

  const platformSelect = $("platformSelect");
  platformSelect.innerHTML = "";
  for (const item of visiblePlatforms()) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.name} (${item.id})`;
    platformSelect.appendChild(option);
  }

  renderWorkflowConfig(appCfg);
  renderVersionPromptConfig();
  renderAiConfig(appCfg);
  renderPresetControls(appCfg);
  renderKnowledgeSummary(state.config.knowledge_summary || {});
  renderLibraryManager();
  renderRuleEditor();
  renderWebSubmitConfig(state.config.web_submit || {});
  if ($("knowledgeUsagePrompt")) $("knowledgeUsagePrompt").value = state.config.knowledge?.usage_prompt || "";

  $("platformsText").value = pretty(state.config.platforms || []);
  $("stylesText").value = pretty(state.config.styles || []);
  restoreWorkFormState();
  updatePlatformHint();
}

function renderWorkflowConfig(appCfg) {
  const workflow = appCfg.workflow || {};
  const fetch = appCfg.fetch || {};
  const rewrite = appCfg.rewrite || {};
  $("workflowAutoClassify").checked = workflow.auto_classify_missing !== false;
  $("workflowAutoFetch").checked = workflow.auto_fetch_original !== false;
  $("workflowAutoRewrite").checked = workflow.auto_rewrite_after_fetch !== false;
  if ($("sensitiveAiProcessEnabled")) {
    $("sensitiveAiProcessEnabled").checked = appCfg.sensitive_ai?.enabled === true;
  }
  $("fetchEndpoint").value = fetch.endpoint || "https://txt.121w.com/api.php";
  $("fetchMaxTxt").value = fetch.default_max_txt || 4000;
  $("fetchConcurrency").value = fetch.concurrency || 4;
  $("fetchRetries").value = fetch.retries ?? 1;
  $("fetchTimeout").value = fetch.timeout_seconds || 30;
  $("fetchAutoDetectPlatform").checked = fetch.auto_detect_platform !== false;
  $("processLineCount").value = rewrite.process_line_count || 5;
  $("anchorLineCount").value = rewrite.anchor_line_count || 5;
  $("rewriteTemp").value = rewrite.temperature ?? 0.45;
  $("methodSequenceInput").value = Array.isArray(rewrite.method_sequence)
    ? rewrite.method_sequence.join(",")
    : (rewrite.method_sequence || "high_imitation,opening_instruction,instruction");
  $("openingPhraseMode").value = rewrite.opening_phrase_mode || "auto";
  $("highImitationMode").value = rewrite.high_imitation_mode || "auto";
  renderRewriteTemplateOptions(rewrite.default_template_id || "");
  $("rewritePrompt").value = rewrite.prompt || "";
  $("processingRulePrompt").value = rewrite.processing_rule_prompt || "";
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function splitLooseList(value) {
  return String(value || "")
    .split(/[\n,，、|/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLooseList(value) {
  return asArray(value).map((item) => String(item || "").trim()).filter(Boolean).join("，");
}

function ensureKnowledgeConfig() {
  state.config.knowledge = state.config.knowledge || {};
  state.config.knowledge.high_imitation = state.config.knowledge.high_imitation || { prompts: [], references: [] };
  state.config.knowledge.high_imitation.prompts = asArray(state.config.knowledge.high_imitation.prompts);
  state.config.knowledge.high_imitation.references = asArray(state.config.knowledge.high_imitation.references);
  state.config.knowledge.opening_phrases = state.config.knowledge.opening_phrases || { items: [] };
  state.config.knowledge.opening_phrases.items = asArray(state.config.knowledge.opening_phrases.items);
  state.config.knowledge.opening_analyzer = state.config.knowledge.opening_analyzer || {};
  state.config.knowledge.rewrite_templates = state.config.knowledge.rewrite_templates || { profiles: [], temporary_instructions: [] };
  state.config.knowledge.rewrite_templates.profiles = asArray(state.config.knowledge.rewrite_templates.profiles);
  state.config.knowledge.layout_rules = state.config.knowledge.layout_rules || {};
  state.config.knowledge.chapter_rules = state.config.knowledge.chapter_rules || { chapter_exact_rules: [], chapter_inline_rules: [] };
  state.config.knowledge.symbol_rules = state.config.knowledge.symbol_rules || { symbol_rules: [], pair_fill_rules: [] };
}

function ensureSensitiveConfig() {
  const current = state.config.sensitive;
  if (Array.isArray(current)) {
    state.config.sensitive = {
      groups: [
        {
          name: "默认敏感词组",
          enabled: true,
          apply_to_original: true,
          apply_to_ai: true,
          rules: current,
        },
      ],
    };
  }
  if (!state.config.sensitive || typeof state.config.sensitive !== "object") {
    state.config.sensitive = { groups: [] };
  }
  state.config.sensitive.groups = asArray(state.config.sensitive.groups);
  if (!state.config.sensitive.groups.length) {
    state.config.sensitive.groups.push({
      name: "默认敏感词组",
      enabled: true,
      apply_to_original: true,
      apply_to_ai: true,
      rules: [],
    });
  }
  for (const group of state.config.sensitive.groups) {
    group.rules = asArray(group.rules);
  }
}

function ensureSensitiveAiConfig() {
  const appCfg = state.config.app_config = state.config.app_config || {};
  const current = appCfg.sensitive_ai || {};
  appCfg.sensitive_ai = {
    enabled: Boolean(current.enabled),
    context_chars: current.context_chars ?? 12,
    max_hits_per_task: current.max_hits_per_task ?? 80,
    concurrency: current.concurrency ?? 4,
    retries: current.retries ?? 1,
    temperature: current.temperature ?? 0.2,
    prompt: current.prompt || [
      "你是内容合规改写助手。请只改写下面命中敏感词的小段内容。",
      "要求：保留原剧情意思、人物关系和情绪；不增加新剧情；去掉违规、擦边、色情、低俗表达。",
      "只返回改写后的小段，不要解释。",
      "",
      "任务ID：{book_id}",
      "命中词：{keyword}",
      "",
      "原片段：",
      "{snippet}",
    ].join("\n"),
  };
  return appCfg.sensitive_ai;
}

function sensitiveAiProcessEnabled() {
  const toggle = $("sensitiveAiProcessEnabled");
  if (toggle) return toggle.checked === true;
  return state.config?.app_config?.sensitive_ai?.enabled === true;
}

function ensureWebSubmitConfig() {
  state.config = state.config || {};
  const current = state.config.web_submit || {};
  const jieyaNum = materialJieyaValue(current.advanced?.jieyaNum ?? 4);
  state.config.web_submit = {
    // 保留旧字段供服务端和历史配置兼容，但网络提交已由任务列表直接触发。
    enabled: true,
    username: current.username || "",
    password: "",
    password_masked: Boolean(current.password_masked),
    skip_submitted: current.skip_submitted !== false,
    min_text_chars: Math.max(0, Number(current.min_text_chars) || 0),
    retry_times: Math.max(0, Number(current.retry_times) || 1),
    upload_profiles: asArray(current.upload_profiles),
    profile_bindings: current.profile_bindings && typeof current.profile_bindings === 'object' ? current.profile_bindings : {},
    advanced: {
      tl5: Number(current.advanced?.tl5) === 1 ? 1 : 0,
      jieyaNum,
      jieyaAiHead: Number(current.advanced?.jieyaAiHead ?? 0),
      jieyaSpeed: Number(current.advanced?.jieyaSpeed ?? 1.7),
      jieyaPitch: Number(current.advanced?.jieyaPitch ?? 0),
      gunpingNum: PER_BOOK_MATERIAL_LIMIT - jieyaNum,
      gunpingSpeed: Number(current.advanced?.gunpingSpeed ?? 1),
      ziti: Number(current.advanced?.ziti ?? 1),
      zitidx: Number(current.advanced?.zitidx ?? 62),
      biaohong: String(current.advanced?.biaohong || ''),
      keywords: String(current.advanced?.keywords || '')
    }
  };
  return state.config.web_submit;
}

function getHighPrompt() {
  ensureKnowledgeConfig();
  const prompts = state.config.knowledge.high_imitation.prompts;
  if (!prompts.length) {
    prompts.push({
      id: "mimic_prompt_default",
      name: "高仿专用指令",
      content: "请学习参考文案的开口方式、节奏和冲突表达，再根据原文进行高仿改写。不能照搬参考剧情，不能新增重大设定。",
      enabled: true,
    });
  }
  return prompts[0];
}

function setHighPromptContent(content) {
  const prompt = getHighPrompt();
  prompt.content = content;
  prompt.prompt = content;
  prompt.system_prompt = content;
}

function libraryDefinition(type = "") {
  ensureKnowledgeConfig();
  const defs = {
    high_imitation: {
      title: "高仿文章库",
      getItems: () => state.config.knowledge.high_imitation.references,
      setItems: (items) => {
        state.config.knowledge.high_imitation.references = items;
      },
      create: () => ({
        id: `mimic_${Date.now()}`,
        name: "新的高仿参考",
        gender: "",
        style: "",
        tags: [],
        reference_text: "",
        analysis: "",
        enabled: true,
      }),
      label: (item, index) => `${item.name || item.id || `高仿参考${index + 1}`} / ${item.style || "未分类"} / ${item.gender || "未分频"}`,
      renderForm: (item) => {
        const prompt = getHighPrompt();
        return `
          <div class="notice">高仿文章库是单独一套改文方法，只给“高仿文章”方案调用。</div>
          <label>
            高仿专用指令
            <textarea id="libHighPrompt" class="small-area" spellcheck="false">${escapeHtml(prompt.content || prompt.prompt || prompt.system_prompt || "")}</textarea>
          </label>
          <div class="control-grid two">
            ${inputField("libId", "条目ID", item.id)}
            ${inputField("libName", "名称", item.name)}
            ${inputField("libStyle", "风格类型", item.style)}
            ${inputField("libGender", "男女频", item.gender)}
            ${inputField("libTags", "标签", joinLooseList(item.tags))}
            ${checkboxField("libEnabled", "启用", item.enabled !== false)}
          </div>
          <label>
            高仿参考正文
            <textarea id="libReferenceText" class="large-area" spellcheck="false">${escapeHtml(item.reference_text || "")}</textarea>
          </label>
          <label>
            拆解备注
            <textarea id="libAnalysis" class="small-area" spellcheck="false">${escapeHtml(item.analysis || "")}</textarea>
          </label>
        `;
      },
      readForm: (oldItem) => {
        setHighPromptContent($("libHighPrompt").value);
        return {
          ...oldItem,
          id: $("libId").value.trim() || oldItem.id || `mimic_${Date.now()}`,
          name: $("libName").value.trim(),
          style: $("libStyle").value.trim(),
          gender: $("libGender").value.trim(),
          tags: splitLooseList($("libTags").value),
          reference_text: $("libReferenceText").value,
          analysis: $("libAnalysis").value,
          enabled: $("libEnabled").checked,
        };
      },
    },
    opening_phrases: {
      title: "爆款开头词库",
      getItems: () => state.config.knowledge.opening_phrases.items,
      setItems: (items) => {
        state.config.knowledge.opening_phrases.items = items;
      },
      create: () => ({
        id: `opening_${Date.now()}`,
        name: "新的开头词",
        style: "",
        content: "",
        analysis: "",
        slot_hint: "",
        tags: [],
        enabled: true,
        linked_template_ids: [],
      }),
      label: (item, index) => `${item.name || item.id || `开头词${index + 1}`} / ${item.style || item.category || "自动风格"}`,
      renderForm: (item) => `
        <div class="notice">爆款开头词库会配合“批量改文指令库”使用，不单独替代整套改文指令。</div>
        <div class="control-grid two">
          ${inputField("libId", "条目ID", item.id)}
          ${inputField("libName", "名称", item.name)}
          ${openingStyleSelect("libStyle", "适用风格类型", item.style || item.category || "")}
          ${inputField("libTags", "标签", joinLooseList(item.tags))}
          ${inputField("libLinkedTemplates", "绑定指令模板ID", joinLooseList(item.linked_template_ids))}
          ${checkboxField("libEnabled", "启用", item.enabled !== false)}
        </div>
        <label>
          开头词骨架
          <textarea id="libContent" class="large-area" spellcheck="false">${escapeHtml(item.content || "")}</textarea>
        </label>
        <label>
          拆解说明
          <textarea id="libAnalysis" class="small-area" spellcheck="false">${escapeHtml(item.analysis || "")}</textarea>
        </label>
        <label>
          槽位 / 适配提示
          <textarea id="libSlotHint" class="small-area" spellcheck="false">${escapeHtml(item.slot_hint || "")}</textarea>
        </label>
      `,
      readForm: (oldItem) => ({
        id: $("libId").value.trim() || oldItem.id || `opening_${Date.now()}`,
        name: $("libName").value.trim(),
        style: $("libStyle").value.trim(),
        tags: splitLooseList($("libTags").value),
        linked_template_ids: splitLooseList($("libLinkedTemplates").value),
        content: $("libContent").value,
        analysis: $("libAnalysis").value,
        slot_hint: $("libSlotHint").value,
        enabled: $("libEnabled").checked,
      }),
    },
    rewrite_templates: {
      title: "批量改文指令库",
      getItems: () => state.config.knowledge.rewrite_templates.profiles,
      setItems: (items) => {
        state.config.knowledge.rewrite_templates.profiles = items;
      },
      create: () => ({
        id: `rewrite_${Date.now()}`,
        name: "新的改文指令",
        system_prompt: "",
        user_prompt_template: "",
        required_variables: ["content_id", "book_name", "style", "gender", "full_text", "target_lines_text", "anchor_lines_text", "line_count", "extra_instruction"],
        response_mode: "changed_lines_json",
        enabled: true,
      }),
      label: (item, index) => `${item.name || item.id || `改文指令${index + 1}`} / ${item.response_mode || "普通输出"}`,
      renderForm: (item) => `
        <div class="notice">这里就是 AI指令模板与提示词逻辑。用户提示词模板会直接参与 AI 改文。</div>
        <div class="control-grid two">
          ${inputField("libId", "模板ID", item.id)}
          ${inputField("libName", "模板名称", item.name)}
          <label>
            返回方式
            <select id="libResponseMode">
              <option value="changed_lines_json" ${item.response_mode === "changed_lines_json" ? "selected" : ""}>只返回改写块JSON</option>
              <option value="plain" ${item.response_mode === "plain" ? "selected" : ""}>直接返回正文</option>
            </select>
          </label>
          ${checkboxField("libEnabled", "启用", item.enabled !== false)}
        </div>
        <label>
          系统提示词
          <textarea id="libSystemPrompt" class="large-area" spellcheck="false">${escapeHtml(item.system_prompt || "")}</textarea>
        </label>
        <label>
          用户提示词模板
          <textarea id="libUserPromptTemplate" class="large-area" spellcheck="false">${escapeHtml(item.user_prompt_template || "")}</textarea>
        </label>
        <label>
          可用变量
          <input id="libRequiredVariables" value="${escapeHtml(joinLooseList(item.required_variables))}" />
        </label>
      `,
      readForm: (oldItem) => ({
        ...oldItem,
        id: $("libId").value.trim() || oldItem.id || `rewrite_${Date.now()}`,
        name: $("libName").value.trim(),
        system_prompt: $("libSystemPrompt").value,
        user_prompt_template: $("libUserPromptTemplate").value,
        required_variables: splitLooseList($("libRequiredVariables").value),
        response_mode: $("libResponseMode").value,
        enabled: $("libEnabled").checked,
      }),
    },
  };
  return defs[type] || defs.high_imitation;
}

function inputField(id, label, value = "") {
  return `<label>${escapeHtml(label)}<input id="${escapeHtml(id)}" value="${escapeHtml(value || "")}" /></label>`;
}

function checkboxField(id, label, checked = false) {
  return `<label class="inline-check"><input id="${escapeHtml(id)}" type="checkbox" ${checked ? "checked" : ""} /> ${escapeHtml(label)}</label>`;
}

function textAreaField(id, label, value = "", className = "small-area") {
  return `<label>${escapeHtml(label)}<textarea id="${escapeHtml(id)}" class="${escapeHtml(className)}" spellcheck="false">${escapeHtml(value || "")}</textarea></label>`;
}

function openingStyleSelect(id, label, selected = "") {
  const options = asArray(state.config?.styles).map((style) => {
    const value = String(style || "").trim();
    return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`;
  }).join("");
  return `
    <label>
      ${escapeHtml(label)}
      <select id="${escapeHtml(id)}">
        <option value="">自动选择</option>
        ${options}
      </select>
    </label>
  `;
}

function renderLibraryManager(selectedIndex = null) {
  const select = $("libraryItemSelect");
  const form = $("libraryForm");
  if (!select || !form) return;
  const type = $("libraryTypeSelect")?.value || "high_imitation";
  renderOpeningAnalyzerPanel(type);
  const def = libraryDefinition(type);
  const items = def.getItems();
  const keyword = ($("librarySearchInput")?.value || "").trim().toLowerCase();
  const filtered = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !keyword || JSON.stringify(item).toLowerCase().includes(keyword));
  select.innerHTML = "";
  for (const { item, index } of filtered) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = def.label(item, index);
    select.appendChild(option);
  }
  if (!filtered.length) {
    select.innerHTML = `<option value="">暂无条目</option>`;
    form.innerHTML = `<div class="detail-empty">没有找到条目，可以新增一个。</div>`;
    return;
  }
  const wanted = selectedIndex === null ? Number(select.value || filtered[0].index) : selectedIndex;
  const match = filtered.find((entry) => entry.index === wanted) || filtered[0];
  select.value = String(match.index);
  form.innerHTML = def.renderForm(items[match.index], match.index);
}

function renderOpeningAnalyzerPanel(type = "") {
  const panel = $("openingAnalyzerSection");
  if (!panel) return;
  panel.classList.toggle("hidden", type !== "opening_phrases");
  if (type !== "opening_phrases") return;
  const select = $("openingAnalyzeStyle");
  if (!select) return;
  const currentValue = select.value || "";
  select.innerHTML = `<option value="">AI自动选择适用风格</option>`;
  for (const style of asArray(state.config?.styles)) {
    const value = String(style || "").trim();
    if (!value) continue;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
  select.value = currentValue;
}

function captureCurrentLibraryForm() {
  const select = $("libraryItemSelect");
  const form = $("libraryForm");
  if (!select || !form || !form.querySelector("input, textarea, select")) return false;
  const type = $("libraryTypeSelect")?.value || "high_imitation";
  const def = libraryDefinition(type);
  const items = [...def.getItems()];
  const index = Number(select.value);
  if (!items.length || !Number.isFinite(index) || !items[index]) return false;
  items[index] = def.readForm(items[index]);
  def.setItems(items);
  return true;
}

function addLibraryItem() {
  captureCurrentLibraryForm();
  const type = $("libraryTypeSelect").value;
  const def = libraryDefinition(type);
  const items = [...def.getItems(), def.create()];
  def.setItems(items);
  renderLibraryManager(items.length - 1);
  $("knowledgeStatus").textContent = "已新增，记得保存知识库配置";
}

function duplicateLibraryItem() {
  captureCurrentLibraryForm();
  const type = $("libraryTypeSelect").value;
  const def = libraryDefinition(type);
  const items = [...def.getItems()];
  const index = Number($("libraryItemSelect").value);
  if (!items[index]) return;
  const next = clone(items[index]);
  next.id = `${next.id || "copy"}_${Date.now()}`;
  next.name = `${next.name || "复制条目"} 副本`;
  items.splice(index + 1, 0, next);
  def.setItems(items);
  renderLibraryManager(index + 1);
  $("knowledgeStatus").textContent = "已复制，记得保存知识库配置";
}

function saveLibraryItem(silent = false) {
  if (!captureCurrentLibraryForm()) return;
  renderLibraryManager(Number($("libraryItemSelect").value || 0));
  renderRewriteTemplateOptions(state.config?.app_config?.rewrite?.default_template_id || "");
  if (!silent) $("knowledgeStatus").textContent = "条目已保存到页面，记得保存知识库配置";
}

function deleteLibraryItem() {
  const type = $("libraryTypeSelect").value;
  const def = libraryDefinition(type);
  const items = [...def.getItems()];
  const index = Number($("libraryItemSelect").value);
  if (!items.length || !Number.isFinite(index) || !items[index]) return;
  if (!confirm("确认删除当前知识库条目？")) return;
  items.splice(index, 1);
  def.setItems(items);
  renderLibraryManager(Math.max(0, index - 1));
  $("knowledgeStatus").textContent = "条目已删除，记得保存知识库配置";
}

async function optimizeLibraryItem() {
  if (!captureCurrentLibraryForm()) return;
  const type = $("libraryTypeSelect").value;
  const def = libraryDefinition(type);
  const items = [...def.getItems()];
  const index = Number($("libraryItemSelect").value);
  if (!items[index]) return;
  $("knowledgeStatus").textContent = "AI优化中...";
  try {
    const result = await api("/api/knowledge/optimize", {
      method: "POST",
      body: JSON.stringify({
        library_type: type,
        item: items[index],
        goal: $("promptImproveGoal").value,
      }),
    });
    items[index] = { ...items[index], ...(result.item || {}) };
    def.setItems(items);
    renderLibraryManager(index);
    $("knowledgeStatus").textContent = "AI建议已填入，确认后保存配置";
  } catch (error) {
    $("knowledgeStatus").textContent = error.message;
  }
}

function ruleList(type) {
  ensureKnowledgeConfig();
  ensureSensitiveConfig();
  if (type === "chapter_exact_rules") return state.config.knowledge.chapter_rules.chapter_exact_rules = asArray(state.config.knowledge.chapter_rules.chapter_exact_rules);
  if (type === "chapter_inline_rules") return state.config.knowledge.chapter_rules.chapter_inline_rules = asArray(state.config.knowledge.chapter_rules.chapter_inline_rules);
  if (type === "symbol_rules") return state.config.knowledge.symbol_rules.symbol_rules = asArray(state.config.knowledge.symbol_rules.symbol_rules);
  if (type === "pair_fill_rules") return state.config.knowledge.symbol_rules.pair_fill_rules = asArray(state.config.knowledge.symbol_rules.pair_fill_rules);
  return [];
}

function renderRuleSelect(list, selectedIndex = 0) {
  const options = list.map((item, index) => `<option value="${index}" ${index === selectedIndex ? "selected" : ""}>${escapeHtml(item.find || item.name || `规则${index + 1}`)}${item.enabled === false ? "（停用）" : ""}</option>`).join("");
  return `<select id="ruleItemSelect" class="list-select" size="10">${options || `<option value="">暂无规则</option>`}</select>`;
}

function ruleHelp(type) {
  return {
    sensitive: "敏感词规则统一管理命中词：开启AI时原文命中小句会交给AI修复；关闭AI时才按替换内容处理。",
    layout_rules: "排版规则会在抓取后和AI返回后自动执行。",
    chapter_exact_rules: "整行命中章节规则时删除整行。",
    chapter_inline_rules: "行内命中章节规则时按设置清洗。",
    symbol_rules: "字位符号会按位置把句子切开或清理。",
    pair_fill_rules: "成对补符号会自动补齐左右符号。",
  }[type] || "添加规则后保存配置";
}

function ruleAiMeta(type) {
  return {
    sensitive: {
      title: "敏感词AI助手",
      sample: "粘贴一段原文或AI文案，AI会提取需要命中的敏感词。",
      goal: "例如：提取违规称呼、敏感动作、平台敏感词；开启AI处理时只需要命中词。",
    },
    layout_rules: {
      title: "批量排版AI助手",
      sample: "粘贴你想对标的排版样本文案，或填入当前处理效果。",
      goal: "例如：建议空行、缩进、是否删除空行、是否清理首尾空格。换行只交给字位符号规则。",
    },
    chapter_exact_rules: {
      title: "章节整行清洗AI助手",
      sample: "粘贴带章节标题的文本，AI会生成整行删除规则。",
      goal: "例如：识别“第1章”“第一章 标题”“章节序号”这类整行清洗规则。",
    },
    chapter_inline_rules: {
      title: "章节行内清洗AI助手",
      sample: "粘贴章节序号和正文在同一行的文本。",
      goal: "例如：识别行内开头的章节序号并生成替换为空的规则。",
    },
    symbol_rules: {
      title: "字位符号AI助手",
      sample: "粘贴符号位置异常、需要按指定位置切句的文本。",
      goal: "例如：分析哪些符号要切分、命中第几位、是否允许相邻命中。",
    },
    pair_fill_rules: {
      title: "成对补符号AI助手",
      sample: "粘贴缺引号、缺括号、符号不成对的文本。",
      goal: "例如：生成左符号和右符号补齐规则。",
    },
  }[type] || {};
}

function renderRuleAiAssistant(type) {
  const meta = ruleAiMeta(type);
  if ($("ruleAiTitle")) $("ruleAiTitle").textContent = meta.title || "规则AI助手";
  if ($("ruleAiSample")) $("ruleAiSample").placeholder = meta.sample || "粘贴样本文案";
  if ($("ruleAiGoal")) $("ruleAiGoal").placeholder = meta.goal || "填写AI处理要求";
  if ($("ruleAiStatus")) $("ruleAiStatus").textContent = "";
  if ($("ruleAiResult")) $("ruleAiResult").textContent = "AI生成后会显示待加入规则。";
}

function renderRuleEditor(selectedIndex = 0) {
  const box = $("ruleManager");
  if (!box) return;
  ensureKnowledgeConfig();
  ensureSensitiveConfig();
  const type = $("ruleTypeSelect")?.value || "sensitive";
  $("ruleHelpText").value = ruleHelp(type);
  state.pendingRuleSuggestions = null;
  renderRuleAiAssistant(type);
  if (type === "sensitive") {
    renderSensitiveRuleEditor();
    return;
  }
  if (type === "layout_rules") {
    renderLayoutRuleEditor();
    return;
  }
  if (type === "chapter_exact_rules" || type === "chapter_inline_rules") {
    renderChapterRuleEditor(type, selectedIndex);
    return;
  }
  renderSymbolRuleEditor(type, selectedIndex);
}

function renderSensitiveRuleEditor() {
  const groups = state.config.sensitive.groups;
  const groupIndex = Math.max(0, Math.min(Number($("sensitiveGroupSelect")?.value || 0), groups.length - 1));
  const group = groups[groupIndex];
  const rules = asArray(group.rules);
  const ruleIndex = Math.max(0, Math.min(Number($("sensitiveRuleSelect")?.value || 0), Math.max(rules.length - 1, 0)));
  const rule = rules[ruleIndex] || { find: "", replace: "", enabled: true };
  const sensitiveAi = ensureSensitiveAiConfig();
  $("ruleManager").innerHTML = `
    <div class="notice">
      敏感词 AI 模式由“处理”页面的开关控制。开启时先调用 AI 修复，AI 失败会自动回退为“查找内容 → 替换为”；关闭时始终直接替换。这里仅维护词组、替换内容和 AI 参数。
    </div>
    <div class="control-grid two">
      ${inputField("sensitiveAiConcurrency", "AI修复并发数", sensitiveAi.concurrency)}
      ${inputField("sensitiveAiMaxHits", "每任务最大命中数", sensitiveAi.max_hits_per_task)}
      ${inputField("sensitiveAiRetries", "AI修复重试次数", sensitiveAi.retries)}
      ${inputField("sensitiveAiContext", "命中句前后扩展字数", sensitiveAi.context_chars)}
      ${inputField("sensitiveAiTemperature", "AI修复温度", sensitiveAi.temperature)}
    </div>
    <label>
      敏感词AI修复提示词
      <textarea id="sensitiveAiPrompt" class="small-area" spellcheck="false">${escapeHtml(sensitiveAi.prompt || "")}</textarea>
    </label>
    <div class="control-grid two">
      <label>
        敏感词组
        <select id="sensitiveGroupSelect">${groups.map((item, index) => `<option value="${index}" ${index === groupIndex ? "selected" : ""}>${escapeHtml(item.name || `词组${index + 1}`)}</option>`).join("")}</select>
      </label>
      ${inputField("sensitiveGroupName", "词组名称", group.name)}
      ${checkboxField("sensitiveGroupEnabled", "启用词组", group.enabled !== false)}
      ${checkboxField("sensitiveApplyOriginal", "处理原文", group.apply_to_original !== false)}
      ${checkboxField("sensitiveApplyAi", "处理AI文案", group.apply_to_ai !== false)}
    </div>
    <div class="actions">
      <button data-rule-action="add-sensitive-group">新增词组</button>
      <button data-rule-action="delete-sensitive-group" class="danger">删除词组</button>
    </div>
    <div class="manager-grid">
      <div>
        <label>规则列表</label>
        <select id="sensitiveRuleSelect" class="list-select" size="10">${rules.map((item, index) => `<option value="${index}" ${index === ruleIndex ? "selected" : ""}>${escapeHtml(item.find || `敏感词${index + 1}`)}${item.enabled === false ? "（停用）" : ""}</option>`).join("") || `<option value="">暂无规则</option>`}</select>
      </div>
      <div class="form-stack">
        ${inputField("sensitiveFind", "查找内容 / 敏感词", rule.find)}
        ${inputField("sensitiveReplace", "替换为（AI失败或关闭时使用）", rule.replace)}
        ${checkboxField("sensitiveRuleEnabled", "启用规则", rule.enabled !== false)}
        <div class="actions">
          <button data-rule-action="add-sensitive-rule">新增敏感词</button>
          <button data-rule-action="delete-sensitive-rule" class="danger">删除敏感词</button>
        </div>
      </div>
    </div>
    <label>
      批量添加敏感词
      <textarea id="sensitiveBulkText" class="large-area" spellcheck="false" placeholder="一行一个：敏感词 或 敏感词=>替换词。AI 失败或关闭时使用替换词。"></textarea>
    </label>
    <div class="actions">
      <button data-rule-action="bulk-sensitive-rule">批量加入当前词组</button>
    </div>
  `;
}

function renderLayoutRuleEditor() {
  const cfg = state.config.app_config = state.config.app_config || {};
  const layoutCfg = cfg.layout = cfg.layout || {};
  const rules = state.config.knowledge.layout_rules = state.config.knowledge.layout_rules || {};
  $("ruleManager").innerHTML = `
    <div class="notice">
      批量排版只负责空行、缩进、敏感词、章节清洗和符号补齐。正文换行只由“字位符号规则”处理。
    </div>
    <div class="control-grid two">
      ${checkboxField("layoutApplyOriginal", "自动处理原文", layoutCfg.apply_to_original !== false)}
      ${checkboxField("layoutApplyAi", "自动处理AI文案", layoutCfg.apply_to_ai !== false)}
      ${checkboxField("layoutApplySensitive", "启用敏感词", layoutCfg.apply_sensitive !== false)}
      ${checkboxField("layoutApplyChapter", "启用章节清洗", layoutCfg.apply_chapter_cleanup !== false)}
      ${checkboxField("layoutApplySymbol", "启用字位符号", layoutCfg.apply_symbol_rules !== false)}
      ${checkboxField("layoutApplyPair", "启用成对补符号", layoutCfg.apply_pair_fill !== false)}
      ${checkboxField("layoutDropEmpty", "删除空行", layoutCfg.drop_empty_lines !== false)}
      ${checkboxField("layoutTrimLines", "清理行首尾空格", layoutCfg.trim_lines !== false)}
      ${inputField("layoutIndentSpaces", "段首空格数", rules.indent_spaces ?? 0)}
      ${inputField("layoutBlankLines", "段落间空行数", rules.blank_lines_before ?? 0)}
      ${checkboxField("layoutSensitiveReplace", "排版时替换敏感词", rules.apply_sensitive_replace !== false)}
    </div>
  `;
}

function renderChapterRuleEditor(type, selectedIndex = 0) {
  const chapter = state.config.knowledge.chapter_rules;
  const list = ruleList(type);
  const index = Math.max(0, Math.min(selectedIndex, Math.max(list.length - 1, 0)));
  const rule = list[index] || { find: "", replace: "", enabled: true };
  $("ruleManager").innerHTML = `
    <div class="control-grid two">
      ${checkboxField("chapterEnabled", "启用章节清洗", chapter.chapter_cleanup_enabled !== false)}
      ${checkboxField("chapterRemoveStandalone", "删除独立章节行", chapter.chapter_remove_standalone !== false)}
      ${checkboxField("chapterRemoveInline", "启用行内章节规则", Boolean(chapter.chapter_remove_inline))}
      ${inputField("chapterMaxN", "最大章节序号", chapter.chapter_max_n ?? 200)}
    </div>
    <div class="manager-grid">
      <div>
        <label>章节规则列表</label>
        ${renderRuleSelect(list, index)}
      </div>
      <div class="form-stack">
        ${textAreaField("ruleFind", "命中规则", rule.find)}
        ${textAreaField("ruleReplace", "替换为", rule.replace)}
        ${checkboxField("ruleEnabled", "启用规则", rule.enabled !== false)}
        <div class="actions">
          <button data-rule-action="add-generic-rule">新增规则</button>
          <button data-rule-action="delete-generic-rule" class="danger">删除规则</button>
        </div>
      </div>
    </div>
  `;
}

function renderSymbolRuleEditor(type, selectedIndex = 0) {
  const symbol = state.config.knowledge.symbol_rules;
  const list = ruleList(type);
  const index = Math.max(0, Math.min(selectedIndex, Math.max(list.length - 1, 0)));
  const rule = list[index] || { find: "", replace: "", enabled: true };
  const title = type === "pair_fill_rules" ? "成对补符号规则" : "字位符号规则";
  $("ruleManager").innerHTML = `
    ${type === "symbol_rules" ? `
      <div class="control-grid two">
        ${checkboxField("symbolTrimEnabled", "启用字位符号切分", Boolean(symbol.enable_symbol_trim))}
        ${checkboxField("symbolAllowAdjacent", "允许相邻位置命中", Boolean(symbol.symbol_trim_allow_adjacent))}
        ${inputField("symbolTrimPositions", "命中位置", symbol.symbol_trim_positions)}
      </div>
    ` : ""}
    <div class="manager-grid">
      <div>
        <label>${title}列表</label>
        ${renderRuleSelect(list, index)}
      </div>
      <div class="form-stack">
        ${textAreaField("ruleFind", type === "pair_fill_rules" ? "左符号" : "符号", rule.find)}
        ${textAreaField("ruleReplace", type === "pair_fill_rules" ? "右符号" : "替换为", rule.replace)}
        ${checkboxField("ruleEnabled", "启用规则", rule.enabled !== false)}
        <div class="actions">
          <button data-rule-action="add-generic-rule">新增规则</button>
          <button data-rule-action="delete-generic-rule" class="danger">删除规则</button>
        </div>
      </div>
    </div>
  `;
}

function captureCurrentRuleForm() {
  const type = $("ruleTypeSelect")?.value || "sensitive";
  ensureKnowledgeConfig();
  ensureSensitiveConfig();
  if (type === "sensitive") {
    const sensitiveAi = ensureSensitiveAiConfig();
    sensitiveAi.concurrency = numberValue("sensitiveAiConcurrency", 4);
    sensitiveAi.max_hits_per_task = numberValue("sensitiveAiMaxHits", 80);
    sensitiveAi.retries = numberValue("sensitiveAiRetries", 1);
    sensitiveAi.context_chars = numberValue("sensitiveAiContext", 12);
    sensitiveAi.temperature = numberValue("sensitiveAiTemperature", 0.2);
    sensitiveAi.prompt = $("sensitiveAiPrompt").value;
    const groupIndex = Number($("sensitiveGroupSelect")?.value || 0);
    const group = state.config.sensitive.groups[groupIndex];
    if (!group) return false;
    group.name = $("sensitiveGroupName").value.trim() || group.name || `词组${groupIndex + 1}`;
    group.enabled = $("sensitiveGroupEnabled").checked;
    group.apply_to_original = $("sensitiveApplyOriginal").checked;
    group.apply_to_ai = $("sensitiveApplyAi").checked;
    const ruleIndex = Number($("sensitiveRuleSelect")?.value || 0);
    if (group.rules[ruleIndex]) {
      group.rules[ruleIndex] = {
        ...group.rules[ruleIndex],
        find: $("sensitiveFind").value,
        replace: $("sensitiveReplace").value,
        enabled: $("sensitiveRuleEnabled").checked,
      };
    }
    return true;
  }
  if (type === "layout_rules") {
    const cfg = state.config.app_config = state.config.app_config || {};
    const layoutCfg = cfg.layout = cfg.layout || {};
    layoutCfg.apply_to_original = $("layoutApplyOriginal").checked;
    layoutCfg.apply_to_ai = $("layoutApplyAi").checked;
    layoutCfg.apply_sensitive = $("layoutApplySensitive").checked;
    layoutCfg.apply_chapter_cleanup = $("layoutApplyChapter").checked;
    layoutCfg.apply_symbol_rules = $("layoutApplySymbol").checked;
    layoutCfg.apply_pair_fill = $("layoutApplyPair").checked;
    layoutCfg.drop_empty_lines = $("layoutDropEmpty").checked;
    layoutCfg.trim_lines = $("layoutTrimLines").checked;
    delete layoutCfg.line_break_mode;
    const rules = state.config.knowledge.layout_rules;
    rules.indent_spaces = Number($("layoutIndentSpaces").value || 0);
    rules.blank_lines_before = Number($("layoutBlankLines").value || 0);
    rules.apply_sensitive_replace = $("layoutSensitiveReplace").checked;
    delete rules.line_break_mode;
    delete rules.line_len_min;
    delete rules.line_len_max;
    delete rules.target_line_len;
    delete rules.enable_len_wrap;
    delete rules.delimiters;
    return true;
  }
  if (type === "chapter_exact_rules" || type === "chapter_inline_rules") {
    const chapter = state.config.knowledge.chapter_rules;
    chapter.chapter_cleanup_enabled = $("chapterEnabled").checked;
    chapter.chapter_remove_standalone = $("chapterRemoveStandalone").checked;
    chapter.chapter_remove_inline = $("chapterRemoveInline").checked;
    chapter.chapter_max_n = Number($("chapterMaxN").value || 200);
  }
  if (type === "symbol_rules") {
    const symbol = state.config.knowledge.symbol_rules;
    symbol.enable_symbol_trim = $("symbolTrimEnabled").checked;
    symbol.symbol_trim_allow_adjacent = $("symbolAllowAdjacent").checked;
    symbol.symbol_trim_positions = $("symbolTrimPositions").value;
  }
  const list = ruleList(type);
  const index = Number($("ruleItemSelect")?.value || 0);
  if (list[index]) {
    list[index] = {
      ...list[index],
      find: $("ruleFind").value,
      replace: $("ruleReplace").value,
      enabled: $("ruleEnabled").checked,
    };
  }
  return true;
}

function saveRuleEditor(silent = false) {
  if (!captureCurrentRuleForm()) return;
  if (!silent) $("ruleEditorStatus").textContent = "规则已保存到页面，记得保存处理规则配置";
}

function handleRuleAction(action) {
  captureCurrentRuleForm();
  const type = $("ruleTypeSelect").value;
  if (action === "add-sensitive-group") {
    state.config.sensitive.groups.push({ name: "新词组", enabled: true, apply_to_original: true, apply_to_ai: true, rules: [] });
    renderSensitiveRuleEditor();
    return;
  }
  if (action === "delete-sensitive-group") {
    if (state.config.sensitive.groups.length <= 1) return;
    state.config.sensitive.groups.splice(Number($("sensitiveGroupSelect").value || 0), 1);
    renderSensitiveRuleEditor();
    return;
  }
  if (action === "add-sensitive-rule") {
    const group = state.config.sensitive.groups[Number($("sensitiveGroupSelect").value || 0)];
    group.rules.push({ find: "", replace: "", enabled: true });
    renderSensitiveRuleEditor();
    return;
  }
  if (action === "delete-sensitive-rule") {
    const group = state.config.sensitive.groups[Number($("sensitiveGroupSelect").value || 0)];
    group.rules.splice(Number($("sensitiveRuleSelect").value || 0), 1);
    renderSensitiveRuleEditor();
    return;
  }
  if (action === "bulk-sensitive-rule") {
    const group = state.config.sensitive.groups[Number($("sensitiveGroupSelect").value || 0)];
    const lines = $("sensitiveBulkText").value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/=>|=|→/);
      group.rules.push({ find: (parts[0] || "").trim(), replace: (parts[1] || "").trim(), enabled: true });
    }
    renderSensitiveRuleEditor();
    return;
  }
  if (action === "add-generic-rule") {
    const list = ruleList(type);
    list.push({ find: "", replace: "", enabled: true });
    renderRuleEditor(list.length - 1);
    return;
  }
  if (action === "delete-generic-rule") {
    const list = ruleList(type);
    list.splice(Number($("ruleItemSelect")?.value || 0), 1);
    renderRuleEditor(0);
  }
}

function currentRuleConfigForAi(type) {
  ensureKnowledgeConfig();
  ensureSensitiveConfig();
  if (type === "sensitive") {
    const group = state.config.sensitive.groups[Number($("sensitiveGroupSelect")?.value || 0)] || {};
    return { group_name: group.name || "", ai_fix: ensureSensitiveAiConfig(), rules: group.rules || [] };
  }
  if (type === "layout_rules") {
    return {
      layout: state.config.app_config?.layout || {},
      layout_rules: state.config.knowledge.layout_rules || {},
    };
  }
  if (type === "chapter_exact_rules" || type === "chapter_inline_rules") {
    return state.config.knowledge.chapter_rules || {};
  }
  return state.config.knowledge.symbol_rules || {};
}

async function suggestCurrentRuleWithAi() {
  const type = $("ruleTypeSelect").value || "sensitive";
  saveRuleEditor(true);
  $("ruleAiStatus").textContent = "AI生成中...";
  $("ruleAiResult").textContent = "正在分析样本文案...";
  try {
    const result = await api("/api/rules/ai-suggest", {
      method: "POST",
      body: JSON.stringify({
        rule_type: type,
        sample_text: $("ruleAiSample").value,
        goal: $("ruleAiGoal").value,
        current_config: currentRuleConfigForAi(type),
      }),
    });
    state.pendingRuleSuggestions = result.suggestions || null;
    renderRuleSuggestionResult();
    $("ruleAiStatus").textContent = "已生成，确认后加入规则";
  } catch (error) {
    state.pendingRuleSuggestions = null;
    $("ruleAiStatus").textContent = error.message;
    $("ruleAiResult").textContent = error.message;
  }
}

function renderRuleSuggestionResult() {
  const box = $("ruleAiResult");
  const suggestions = state.pendingRuleSuggestions;
  if (!box) return;
  if (!suggestions) {
    box.textContent = "AI生成后会显示待加入规则。";
    return;
  }
  const rows = [];
  for (const key of ["rules", "chapter_exact_rules", "chapter_inline_rules", "symbol_rules", "pair_fill_rules"]) {
    for (const item of asArray(suggestions[key])) {
      if (!item || typeof item !== "object") continue;
      rows.push(`<div class="suggestion-item"><b>${escapeHtml(key)}</b><span>${escapeHtml(item.find || "")}${item.replace ? ` → ${escapeHtml(item.replace)}` : ""}</span></div>`);
    }
  }
  if (suggestions.layout_rules || suggestions.layout) {
    rows.push(`<div class="suggestion-item"><b>排版参数</b><span>${escapeHtml(Object.keys(suggestions.layout_rules || {}).concat(Object.keys(suggestions.layout || {})).join("，") || "无")}</span></div>`);
  }
  box.innerHTML = rows.join("") || `<div class="suggestion-item"><b>没有生成可加入规则</b><span>可以调整样本文案或AI处理要求后重试。</span></div>`;
}

function appendRulesUnique(target, incoming) {
  const list = asArray(target);
  const seen = new Set(list.map((item) => `${item?.find || ""}=>${item?.replace || ""}`));
  for (const item of asArray(incoming)) {
    if (!item || typeof item !== "object" || !String(item.find || "").trim()) continue;
    const next = { find: String(item.find || "").trim(), replace: String(item.replace || ""), enabled: item.enabled !== false };
    const key = `${next.find}=>${next.replace}`;
    if (seen.has(key)) continue;
    list.push(next);
    seen.add(key);
  }
  return list;
}

function applyRuleSuggestions() {
  const suggestions = state.pendingRuleSuggestions;
  if (!suggestions) {
    $("ruleAiStatus").textContent = "还没有AI生成的规则";
    return;
  }
  const type = suggestions.rule_type || $("ruleTypeSelect").value || "sensitive";
  ensureKnowledgeConfig();
  ensureSensitiveConfig();
  if (type === "sensitive") {
    const group = state.config.sensitive.groups[Number($("sensitiveGroupSelect")?.value || 0)] || state.config.sensitive.groups[0];
    group.rules = appendRulesUnique(group.rules, suggestions.rules);
    $("ruleAiStatus").textContent = `已加入 ${asArray(suggestions.rules).length} 条敏感词规则`;
    renderSensitiveRuleEditor();
  } else if (type === "layout_rules") {
    state.config.knowledge.layout_rules = {
      ...(state.config.knowledge.layout_rules || {}),
      ...(suggestions.layout_rules || {}),
    };
    state.config.app_config = state.config.app_config || {};
    state.config.app_config.layout = {
      ...(state.config.app_config.layout || {}),
      ...(suggestions.layout || {}),
    };
    $("ruleAiStatus").textContent = "已应用排版参数";
    renderLayoutRuleEditor();
  } else if (type === "chapter_exact_rules" || type === "chapter_inline_rules") {
    const chapter = state.config.knowledge.chapter_rules;
    chapter.chapter_exact_rules = appendRulesUnique(chapter.chapter_exact_rules, suggestions.chapter_exact_rules);
    chapter.chapter_inline_rules = appendRulesUnique(chapter.chapter_inline_rules, suggestions.chapter_inline_rules);
    if (suggestions.settings && typeof suggestions.settings === "object") {
      Object.assign(chapter, suggestions.settings);
    }
    renderRuleEditor(0);
    $("ruleAiStatus").textContent = "已加入章节清洗规则";
  } else if (type === "symbol_rules") {
    const symbol = state.config.knowledge.symbol_rules;
    symbol.symbol_rules = appendRulesUnique(symbol.symbol_rules, suggestions.symbol_rules);
    if (suggestions.settings && typeof suggestions.settings === "object") {
      Object.assign(symbol, suggestions.settings);
    }
    renderRuleEditor(0);
    $("ruleAiStatus").textContent = "已加入字位符号规则";
  } else if (type === "pair_fill_rules") {
    const symbol = state.config.knowledge.symbol_rules;
    symbol.pair_fill_rules = appendRulesUnique(symbol.pair_fill_rules, suggestions.pair_fill_rules);
    renderRuleEditor(0);
    $("ruleAiStatus").textContent = "已加入成对补符号规则";
  }
  state.pendingRuleSuggestions = null;
  if ($("ruleAiResult")) $("ruleAiResult").textContent = "已加入对应规则，记得保存处理规则配置。";
}

function renderRewriteTemplateOptions(selectedId = "") {
  const select = $("rewriteTemplateSelect");
  const profiles = state.config?.knowledge?.rewrite_templates?.profiles || [];
  const options = profiles
    .filter((item) => item && item.enabled !== false)
    .map((item) => ({ id: item.id || "", name: item.name || item.id || "" }));
  select.innerHTML = `<option value="">自动选择</option>`;
  for (const item of options) {
    const option = document.createElement("option");
    option.value = item.id || "";
    option.textContent = item.name || item.id || "";
    select.appendChild(option);
  }
  select.value = selectedId || "";
}

function renderKnowledgeSummary(summary) {
  const box = $("knowledgeSummary");
  if (!box) return;
  const items = [
    ["开头词", summary.opening_phrases || 0],
    ["适用风格", summary.opening_styles || summary.opening_categories || 0],
    ["改文模板", summary.rewrite_profiles || 0],
    ["临时指令", summary.temporary_instructions || 0],
    ["高仿提示词", summary.high_imitation_prompts || 0],
    ["高仿参考", summary.high_imitation_references || 0],
    ["敏感词", summary.sensitive_rules || 0],
    ["字位符号", summary.symbol_rules || 0],
    ["成对补符号", summary.pair_fill_rules || 0],
    ["章节整行", summary.chapter_exact_rules || 0],
    ["章节开头", summary.chapter_inline_rules || 0],
  ];
  box.innerHTML = items.map(([label, value]) => `
    <div class="knowledge-pill">
      <b>${escapeHtml(label)}</b>
      <span>${escapeHtml(value)}</span>
    </div>
  `).join("");
}

function renderAiConfig(appCfg) {
  applyAiSettingsToForm(appCfg.ai || {});
}

function renderPresetControls(appCfg) {
  const presets = appCfg.ai_presets || [];
  const presetSelect = $("presetSelect");
  presetSelect.innerHTML = "";
  if (!presets.length) {
    presetSelect.innerHTML = `<option value="">暂无预设</option>`;
  } else {
    for (const preset of presets) {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = `${preset.name || preset.id} (${preset.model || "未填模型"})`;
      presetSelect.appendChild(option);
    }
  }

  const assignmentOptions = presetOptions();
  renderOptions($("classifierSelect"), assignmentOptions);
  renderOptions($("rewriteSelect"), assignmentOptions);
  if ($("sensitiveFixSelect")) renderOptions($("sensitiveFixSelect"), assignmentOptions);
  const assignments = appCfg.ai_assignments || {};
  $("classifierSelect").value = assignments.classifier || "__current__";
  $("rewriteSelect").value = assignments.rewrite || "__current__";
  if ($("sensitiveFixSelect")) $("sensitiveFixSelect").value = assignments.sensitive_fix || "__current__";
}

function applyAiSettingsToForm(settings) {
  $("aiBaseUrl").value = settings.base_url || "";
  $("aiApiKey").value = settings.api_key || "";
  $("aiModel").value = settings.model || "";
  $("aiTimeout").value = settings.timeout_seconds || 180;
  $("aiConcurrency").value = settings.max_concurrency || 6;
  $("aiRetries").value = settings.retry_times ?? 2;
  $("aiStream").checked = Boolean(settings.stream);
  $("aiJsonMode").checked = Boolean(settings.json_mode);
  $("aiMaxTokens").value = settings.max_tokens || 1200;
  $("aiTemperature").value = settings.temperature ?? 0.45;
  $("aiTopP").value = settings.top_p ?? 0.9;
  $("aiPresence").value = settings.presence_penalty ?? 0;
  $("aiFrequency").value = settings.frequency_penalty ?? 0;
  $("aiEnableThinking").checked = Boolean(settings.enable_thinking);
  $("aiDisableThinking").checked = Boolean(settings.disable_thinking);
  $("aiExtraJson").value = settings.extra_body_json || "";
}

function readAiSettingsFromForm() {
  return {
    base_url: $("aiBaseUrl").value.trim(),
    api_key: $("aiApiKey").value.trim(),
    model: $("aiModel").value.trim(),
    timeout_seconds: numberValue("aiTimeout", 180),
    max_concurrency: numberValue("aiConcurrency", 6),
    retry_times: numberValue("aiRetries", 2),
    stream: $("aiStream").checked,
    json_mode: $("aiJsonMode").checked,
    max_tokens: numberValue("aiMaxTokens", 1200),
    temperature: numberValue("aiTemperature", 0.45),
    top_p: numberValue("aiTopP", 0.9),
    presence_penalty: numberValue("aiPresence", 0),
    frequency_penalty: numberValue("aiFrequency", 0),
    enable_thinking: $("aiEnableThinking").checked,
    disable_thinking: $("aiDisableThinking").checked,
    extra_body_json: $("aiExtraJson").value.trim(),
  };
}

// 当前填写的 AI 接口不是一次性表单值：保存时同步为一个可见的“当前预设”，
// 并让三个工作用途优先使用它。手动创建的其他预设不受影响。
function syncCurrentAiPreset(cfg) {
  const settings = cfg.ai || {};
  if (!settings.base_url || !settings.api_key || !settings.model) return "";
  const id = "preset_current_auto";
  const preset = {
    ...settings,
    id,
    name: `当前预设（自动同步）· ${settings.model}`,
    auto_managed: true,
  };
  const presets = Array.isArray(cfg.ai_presets) ? [...cfg.ai_presets] : [];
  const index = presets.findIndex((item) => item?.id === id);
  if (index >= 0) presets[index] = preset;
  else presets.unshift(preset);
  cfg.ai_presets = presets;
  cfg.ai_assignments = {
    ...(cfg.ai_assignments || {}),
    classifier: id,
    rewrite: id,
    sensitive_fix: id,
  };
  return id;
}

function updatePlatformHint() {
  const id = $("platformSelect").value;
  const found = (state.config?.platforms || []).find((item) => String(item.id) === String(id));
  $("platformHint").textContent = found ? `平台ID：${found.id}` : "";
}

function renderWebSubmitConfig(settings = {}) {
  if (!$("webAllowResubmit")) return;
  const cfg = ensureWebSubmitConfig();
  Object.assign(cfg, settings || {});
  $("webAllowResubmit").checked = cfg.skip_submitted === false;
  $("webMinTextChars").value = cfg.min_text_chars ?? 0;
  $("webRetryTimes").value = cfg.retry_times ?? 1;
  $("webProfilesJson").value = JSON.stringify(cfg.upload_profiles || [], null, 2);
  $("webProfileBindingsJson").value = JSON.stringify(cfg.profile_bindings || {}, null, 2);
  renderWebDefaultProfileOptions(cfg.upload_profiles || [], cfg.selected_profile || "");
  renderWebVersionProfileBindings(cfg.upload_profiles || [], cfg.profile_bindings || {});

  updateResubmitHint();
  renderWebSubmitMode();
  renderWebLoginStatus(cfg);
}

function renderWebLoginStatus(settings = {}) {
  const box = $("webLoginStatus");
  if (!box) return;
  const username = String(settings.username || "").trim();
  const stateClass = state.webLoginSession === false ? "error" : username && state.webLoginSession ? "ok" : "not-logged-in";
  box.className = `web-login-status ${stateClass}`;
  const label = username && state.webLoginSession ? username : (state.webLoginSession === false ? (username || "登录异常") : "未登录");
  box.innerHTML = `<span class="web-login-dot" aria-hidden="true"></span><span>${escapeHtml(label)}</span>`;
}

async function openWebLoginDialog() {
  let dialog = $("webLoginDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "webLoginDialog";
    dialog.innerHTML = `<form method="dialog" class="login-dialog-form"><h3>登录批量后台</h3><p class="form-hint">登录后处理页会显示账号和状态点，提交任务时自动复用此会话。</p><label>账号<input id="webLoginUsername" autocomplete="username"></label><label>密码<input id="webLoginPassword" type="password" autocomplete="current-password"></label><div class="actions"><button value="cancel">取消</button><button id="webLoginSubmit" value="default" class="primary">保存并验证</button></div><span id="webLoginResult"></span></form>`;
    document.body.appendChild(dialog);
    dialog.addEventListener("submit", async (event) => {
      if (event.submitter?.id !== "webLoginSubmit") return;
      event.preventDefault();
      const result = $("webLoginResult"); result.textContent = "验证中...";
      $("webLoginSubmit").disabled = true;
      try {
        const settings = { ...(state.config?.web_submit || {}), username: $("webLoginUsername").value.trim(), password: $("webLoginPassword").value };
        // Verify credentials before persisting them to the local web-submit config.
        const login = await novelFetchPlatformApi("/api/novel-fetch-upload/upload-login", {
          method: "POST",
          body: JSON.stringify({ username: settings.username, password: settings.password }),
        });
        if (login.ok !== true) throw new Error(login.error || "登录验证失败");
        await api("/api/web-submit/config", { method: "POST", body: JSON.stringify({ settings }) });
        state.webLoginSession = login.ok === true;
        state.config.web_submit = { ...(state.config.web_submit || {}), username: settings.username, password_masked: true };
        renderWebLoginStatus(state.config.web_submit);
        result.textContent = state.webLoginSession ? "登录验证成功" : "登录异常";
        if (state.webLoginSession) setTimeout(() => dialog.close(), 500);
      } catch (error) { state.webLoginSession = false; renderWebLoginStatus(state.config.web_submit || {}); result.textContent = error.message; }
      finally { $("webLoginSubmit").disabled = false; }
    });
  }
  $("webLoginUsername").value = state.config?.web_submit?.username || "";
  $("webLoginPassword").value = "";
  dialog.showModal();
}

function webSubmitModeFromForm() {
  return "version";
}

function renderWebSubmitMode() {
  $("webVersionConfigSection")?.classList.remove("hidden");
}

function renderWebDefaultProfileOptions(profiles, selectedProfile) {
  const select = $("webDefaultProfile");
  if (!select) return;
  const items = asArray(profiles);
  const saved = String(selectedProfile || "");
  const selected = items.find((profile) => String(profile?.id || "") === saved || String(profile?.name || "") === saved)?.id || "";
  const options = ["<option value=\"\">按书籍自动匹配</option>"];
  for (const profile of items) {
    const id = String(profile?.id || "").trim();
    const name = String(profile?.name || id).trim();
    if (!id) continue;
    options.push(`<option value="${escapeHtml(id)}" ${id === selected ? "selected" : ""}>${escapeHtml(name)}</option>`);
  }
  select.innerHTML = options.join("");
}

function profileIdFromIdentity(profiles, identity) {
  const value = String(identity || "");
  return asArray(profiles).find((profile) => String(profile?.id || "") === value || String(profile?.name || "") === value)?.id || "";
}

function renderWebVersionProfileBindings(profiles, bindings) {
  const fields = { original: "webProfileBindingOriginal", ai1: "webProfileBindingAi1", ai2: "webProfileBindingAi2", ai3: "webProfileBindingAi3", ai4: "webProfileBindingAi4", ai5: "webProfileBindingAi5" };
  const items = asArray(profiles);
  for (const [version, id] of Object.entries(fields)) {
    const select = $(id);
    if (!select) continue;
    const selected = profileIdFromIdentity(items, bindings?.[version]);
    const options = ["<option value=\"\">跟随默认配置档</option>"];
    for (const profile of items) {
      const profileId = String(profile?.id || "").trim();
      const name = String(profile?.name || profileId).trim();
      if (!profileId) continue;
      options.push(`<option value="${escapeHtml(profileId)}" ${profileId === selected ? "selected" : ""}>${escapeHtml(name)}</option>`);
    }
    select.innerHTML = options.join("");
  }
}

function webProfileBindingsFromForm() {
  return {
    original: $("webProfileBindingOriginal")?.value || "",
    ai1: $("webProfileBindingAi1")?.value || "",
    ai2: $("webProfileBindingAi2")?.value || "",
    ai3: $("webProfileBindingAi3")?.value || "",
    ai4: $("webProfileBindingAi4")?.value || "",
    ai5: $("webProfileBindingAi5")?.value || ""
  };
}

function updateResubmitHint() {
  const allow = $("webAllowResubmit")?.checked === true;
  const hint = $("webResubmitHint");
  if (hint) hint.textContent = allow
    ? "已开启：已成功版本会再次上传。"
    : "默认保护：已成功版本会跳过。";
}

function syncFormToWebSubmitConfig() {
  const cfg = clone(ensureWebSubmitConfig());
  // 兼容旧配置字段；是否执行由任务列表的“提交网络”按钮决定。
  cfg.enabled = true;
  // 账号只在登录弹窗中维护，提交设置保存时保留当前凭据。
  if ($("webUsername")) cfg.username = $("webUsername").value.trim();
  if ($("webPassword")) cfg.password = $("webPassword").value.trim();
  cfg.skip_submitted = !$("webAllowResubmit").checked;
  cfg.submit_mode = "version";
  cfg.min_text_chars = numberValue("webMinTextChars", 0);
  cfg.retry_times = numberValue("webRetryTimes", 1);
  cfg.upload_profiles = parseJsonInput("webProfilesJson", []);
  cfg.profile_bindings = webProfileBindingsFromForm();
  $("webProfileBindingsJson").value = JSON.stringify(cfg.profile_bindings);
  cfg.selected_profile = $("webDefaultProfile").value;
  cfg.submit_versions = selectedProcessVersions();
  return cfg;
}

function setSiteSubmitStatus(text) {
  if ($("siteSubmitStatus")) $("siteSubmitStatus").textContent = text || "";
}

function setVersionConfigStatus(text) {
  if ($("webSubmitSelectionStatus")) $("webSubmitSelectionStatus").textContent = text || "";
}

async function saveWebSubmitConfig(silent = false) {
  if (!silent) setSiteSubmitStatus("网站提交配置保存中...");
  try {
    const result = await api("/api/web-submit/config", {
      method: "POST",
      body: JSON.stringify({ settings: syncFormToWebSubmitConfig() }),
    });
    state.config.web_submit = result.settings || state.config.web_submit;
    renderWebSubmitConfig(state.config.web_submit);
    if (result.tasks) renderTasks(result.tasks || []);
    if (!silent) setSiteSubmitStatus("网站提交配置已保存");
    return result;
  } catch (error) {
    if (!silent) setSiteSubmitStatus(error.message);
    if (silent) throw error;
    return null;
  }
}

async function confirmWebSubmitSelection() {
  const status = $("webSubmitSelectionStatus");
  const versions = selectedProcessVersions();
  if (!versions.length) {
    if (status) status.textContent = "请至少选择一个文案版本";
    return;
  }
  if (status) status.textContent = "正在保存版本配置...";
  try {
    await saveWorkFormStateNow();
    syncVersionPromptConfigToForm();
    await saveConfig(true);
    const result = await saveWebSubmitConfig(true);
    if (result) {
      if (status) status.textContent = `已保存：${versions.map(version => version.toUpperCase()).join("、")}；任务会直接使用这些版本。`;
      updateVersionConfigSummary();
      closeVersionConfigCard();
    } else if (status) {
      status.textContent = "确认失败，请检查连接与设置。";
    }
  } catch (error) {
    if (status) status.textContent = error.message;
  }
}

async function syncWebSubmit(kind) {
  const label = kind === "styles" ? "批量风格类型" : "批量后台配置";
  setSiteSubmitStatus(`正在同步${label}...`);
  setVersionConfigStatus(`正在同步${label}...`);
  try {
    await saveWebSubmitConfig(true);
    const result = await api(kind === "styles" ? "/api/web-submit/sync-styles" : "/api/web-submit/sync-configs", {
      method: "POST",
      body: "{}",
    });
    state.config.web_submit = result.settings || state.config.web_submit;
    if (result.styles) state.config.styles = result.styles;
    renderWebSubmitConfig(state.config.web_submit);
    const styleText = result.style_sync
      ? `，AI风格 ${result.style_sync.new_count || 0} 个，新增 ${result.style_sync.added?.length || 0}，删除 ${result.style_sync.removed?.length || 0}`
      : "";
    const configText = kind === "configs" ? `：${result.groups?.length || 0} 个配置档已更新` : "";
    const message = `已同步${label}${configText}${styleText}`;
    setSiteSubmitStatus(message);
    setVersionConfigStatus(message);
  } catch (error) {
    setSiteSubmitStatus(error.message);
    setVersionConfigStatus(error.message);
  }
}

async function checkWebEnvironment() {
  setSiteSubmitStatus("正在检查内置运行环境...");
  try {
    await saveWebSubmitConfig(true);
    const result = await api("/api/web-submit/environment");
    const rows = asArray(result.checks).map((item) => `
      <div class="site-skipped-row">
        <code>${escapeHtml(item.ok ? "正常" : "异常")}</code>
        <span>${escapeHtml(item.name || "")}</span>
        <span>${escapeHtml(item.detail || "")}</span>
      </div>
    `).join("");
    if ($("siteSubmitGroups")) {
      $("siteSubmitGroups").innerHTML = `
        <div class="site-group-card">
          <div class="site-group-head"><b>环境自检</b><span class="${result.ok ? "status-ok" : "status-error"}">${result.ok ? "通过" : "存在问题"}</span></div>
          <div class="site-skipped-list">${rows}</div>
        </div>
      `;
    }
    setSiteSubmitStatus(result.ok ? "环境自检通过" : "环境自检发现问题");
  } catch (error) {
    setSiteSubmitStatus(error.message);
  }
}

async function testVisibleWebFlow() {
  const button = $("testVisibleWebBtn");
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "验证中…";
  setSiteSubmitStatus("正在验证 121 登录会话...");
  try {
    await saveWebSubmitConfig(true);
    const result = await novelFetchPlatformApi("/api/batch-rewrite/web-submit/test-visible", {
      method: "POST",
      body: JSON.stringify(webSubmitRequestPayload(state.selectedIds.size ? "selected" : "all", true)),
    });
    const checks = result.result?.checks || {};
    const checkRows = Object.keys(checks).map((key) => `
      <div class="site-skipped-row">
        <code>${escapeHtml(key)}</code>
        <span>${escapeHtml(String(checks[key]))}</span>
      </div>
    `).join("");
    if ($("siteSubmitGroups")) {
      $("siteSubmitGroups").innerHTML = `
        <div class="site-group-card">
          <div class="site-group-head"><b>121 登录会话验证</b><span class="${result.ok ? "status-ok" : "status-error"}">${result.ok ? "完成" : "失败"}</span></div>
          <div class="site-skipped-list">${checkRows || "暂无检查项"}</div>
          <pre class="site-output">${escapeHtml(asArray(result.output).join("\n"))}</pre>
        </div>
      `;
    }
    setSiteSubmitStatus(result.ok ? "121 登录会话有效；此检查不会上传文件或确认生成任务" : "121 登录会话验证失败");
  } catch (error) {
    setSiteSubmitStatus(error.message);
    if ($("siteSubmitGroups")) {
      $("siteSubmitGroups").innerHTML = `
        <div class="site-group-card">
          <div class="site-group-head"><b>121 登录会话验证</b><span class="status-error">未通过</span></div>
          <div class="site-skipped-list">
            <div class="site-skipped-row"><code>需要处理</code><span>${escapeHtml(error.message || "验证失败")}</span></div>
          </div>
        </div>
      `;
    }
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function clearWebPreview() {
  if ($("siteSubmitGroups")) $("siteSubmitGroups").innerHTML = "";
  setSiteSubmitStatus("预览已隐藏，不影响任务和提交记录");
}

function renderWebSubmitHistory(records = []) {
  const box = $("siteSubmitHistory");
  if (!box) return;
  const rows = asArray(records).map((item) => {
    const allocation = item.material_allocation || {};
    const allocationText = allocation.jieyaNum === undefined ? "" : `解压 ${allocation.jieyaNum} / 滚屏 ${allocation.gunpingNum}`;
    return `<div class="site-history-row">
      <code title="${escapeHtml(item.book_id || "")}">${escapeHtml(item.book_id || "")}</code>
      <span class="site-history-name" title="${escapeHtml(item.book_name || "")}">${escapeHtml(item.book_name || "-")}</span>
      <span>${escapeHtml(item.version || "-")}</span>
      <span class="${statusClass(item.status)}">${escapeHtml(item.status || "-")}</span>
      <span>${escapeHtml(allocationText || "-")}</span>
      <time title="${escapeHtml(item.time || "")}">${escapeHtml(item.time || "-")}</time>
      <span class="site-history-error" title="${escapeHtml(item.result || item.error || "")}">${escapeHtml(item.result || item.error || "-")}</span>
    </div>`;
  }).join("");
  box.innerHTML = rows ? `<div class="site-history-table">
    <div class="site-history-row site-history-head"><span>书籍 ID</span><span>书名</span><span>版本</span><span>状态</span><span>素材</span><span>提交时间</span><span>结果 / 错误</span></div>
    ${rows}
  </div>` : `<div class="log-row">暂无实际网站提交记录。</div>`;
}

async function loadWebSubmitHistory() {
  try {
    const data = await api("/api/web-submit/history");
    renderWebSubmitHistory(data.records || []);
  } catch (error) {
    const box = $("siteSubmitHistory");
    if (box) box.innerHTML = `<div class="log-row">${escapeHtml(error.message || "提交历史读取失败")}</div>`;
  }
}

function webSubmitRequestPayload(mode, force = false) {
  const ids = mode === "selected" ? selectedTaskIds() : [];
  return {
    mode,
    ids,
    force,
    grouped: true,
  };
}

function showWebSubmitSelectionRequired() {
  if (!$('siteSubmitGroups')) return;
  $("siteSubmitGroups").innerHTML = `
    <div class="site-group-card">
      <div class="site-group-head"><b>还没有选中任务</b><span class="status-warn">需要先选择</span></div>
      <div class="site-skipped-list">
        <div class="site-skipped-row"><code>下一步</code><span>切换到“任务列表”，勾选每条任务最左侧的复选框；再回到这里预览或提交选中任务。</span></div>
      </div>
    </div>
  `;
}

async function previewWebSubmit(mode) {
  if (mode === "selected" && !selectedTaskIds().length) {
    setSiteSubmitStatus("先选择任务");
    showWebSubmitSelectionRequired();
    return;
  }
  setSiteSubmitStatus("正在预览网站提交分组...");
  try {
    await saveWebSubmitConfig(true);
    const result = await api("/api/web-submit/preview", {
      method: "POST",
      body: JSON.stringify(webSubmitRequestPayload(mode, false)),
    });
    renderWebSubmitGroups(result);
    setSiteSubmitStatus(`预览完成：${result.groups?.length || 0} 个提交组，跳过 ${result.skipped?.length || 0} 条`);
  } catch (error) {
    setSiteSubmitStatus(error.message);
  }
}

async function submitWebSubmit(mode) {
  if (mode === "selected" && !selectedTaskIds().length) {
    setSiteSubmitStatus("先选择任务");
    setBatchStatus("先选择任务");
    showWebSubmitSelectionRequired();
    return;
  }
  const label = mode === "all" ? "全部任务" : (mode === "failed" ? "提交失败任务" : `${selectedTaskIds().length} 个选中任务`);
  if (!confirm(`确认提交${label}到网站？系统会按平台、男女频、风格类型自动分组上传。`)) return;
  setBatchStatus(`排队中：${label}`);
  setSiteSubmitStatus(`正在提交${label}...`);
  let polling = false;
  try {
    await saveWebSubmitConfig(true);
    setBatchStatus(`上传中：${label}`);
    const submitPromise = api("/api/web-submit/submit", {
      method: "POST",
      body: JSON.stringify(webSubmitRequestPayload(mode, mode === "failed")),
    });
    polling = true;
    const poll = (async () => {
      while (polling) {
        await sleep(700);
        if (!polling) break;
        try { await loadTasks(); } catch (_) {}
      }
    })();
    const result = await submitPromise;
    polling = false;
    await poll;
    renderWebSubmitGroups(result);
    renderTasks(result.tasks || state.tasks);
    await loadWebSubmitHistory();
    if (Number(result.failed_groups) > 0) reportBatchIssue("result", "/api/web-submit/submit", `网站提交失败 ${result.failed_groups} 组`);
    const summary = `提交完成：已确认 ${result.success_groups || 0} 组，121 待确认 ${result.accepted_groups || 0} 组，失败 ${result.failed_groups || 0} 组`;
    setSiteSubmitStatus(summary);
    setBatchStatus(summary);
  } catch (error) {
    polling = false;
    setSiteSubmitStatus(error.message);
    setBatchStatus(`提交失败：${error.message}`);
    await loadTasks().catch(() => {});
  }
}

function siteSubmitText(task) {
  const queued = asArray(task.site_submit_queued_versions);
  const uploading = asArray(task.site_submit_uploading_versions);
  const done = asArray(task.site_submit_done_versions);
  const accepted = asArray(task.site_submit_accepted_versions);
  const failed = asArray(task.site_submit_failed_versions);
  // 同一版本曾失败但后来已成功提交时，成功结果才是当前状态；
  // 失败记录仍保留在“记录”和“问题日志”中供追溯。
  const parts = [];
  if (done.length) parts.push(`已提交：${done.join(",")}`);
  if (uploading.length) parts.push(`上传中：${uploading.join(",")}`);
  if (queued.length) parts.push(`排队中：${queued.join(",")}`);
  if (accepted.length) parts.push(`待确认：${accepted.join(",")}`);
  if (failed.length) parts.push(`失败：${failed.join(",")}`);
  if (parts.length) return parts.join("；");
  if (task.site_submit_status) return task.site_submit_status;
  return "未提交";
}

function groupCardHtml(group) {
  const summary = group.summary || {};
  const advanced = group.advanced || {};
  const items = asArray(group.items);
  const status = group.status || "";
  const itemRows = items.slice(0, 24).map((item) => {
    const itemAdvanced = item.advanced || advanced;
    return `
    <div class="site-file-row">
      <code>${escapeHtml(item.id || "")}</code>
      <span>${escapeHtml(item.version || group.version || "")}</span>
      <span>${escapeHtml(`解压 ${itemAdvanced.jieyaNum ?? 0} / 滚屏 ${itemAdvanced.gunpingNum ?? 0}`)}</span>
      <span>${escapeHtml(item.size ? `${item.size}字节` : "")}</span>
    </div>
  `;
  }).join("");
  return `
    <div class="site-group-card">
      <div class="site-group-head">
        <b>${escapeHtml(group.group_id || "提交组")}</b>
        <span class="${statusClass(status)}">${escapeHtml(status || "待提交")}</span>
      </div>
      <div class="meta-grid compact">
        ${metaItem("平台", `${summary.platform_name || ""} ${summary.platform_id || ""}`)}
        ${metaItem("男女频", `${summary.gender || ""} ${summary.gender_value || ""}`)}
        ${metaItem("风格", `${summary.style || ""} ${summary.style_value || ""}`)}
        ${metaItem("版本", group.version || summary.version || "")}
        ${metaItem("配置档", summary.profile_name || "默认上传参数")}
        ${metaItem("任务数", String(items.length || group.count || 0))}
        ${metaItem("时长", Number(advanced.tl5) === 1 ? "限制" : "不限制")}
        ${metaItem("每本书解压总量", `${advanced.jieyaNum ?? 4} 个 / ${advanced.jieyaSpeed ?? 1.7}x`)}
        ${metaItem("每本书滚屏总量", `${advanced.gunpingNum ?? 4} 个 / ${advanced.gunpingSpeed ?? 1}x`)}
        ${metaItem("错误", group.error || "")}
      </div>
      <div class="site-file-list">${itemRows || "暂无文件"}</div>
      ${group.helper_output ? `<pre class="site-output">${escapeHtml(asArray(group.helper_output).join("\n"))}</pre>` : ""}
    </div>
  `;
}

function renderWebSubmitGroups(data = {}) {
  if (!$("siteSubmitGroups")) return;
  const groups = asArray(data.groups || data.results);
  const skipped = asArray(data.skipped);
  const skippedRows = skipped.slice(0, 80).map((item) => `
    <div class="site-skipped-row">
      <code>${escapeHtml(item.id || "")}</code>
      <span>${escapeHtml(item.version || "")}</span>
      <span>${escapeHtml(item.status || "")}</span>
      <span>${escapeHtml(item.error || "")}</span>
    </div>
  `).join("");
  $("siteSubmitGroups").innerHTML = `
    ${groups.map(groupCardHtml).join("") || `<div class="detail-empty small">暂无可提交分组。请先选择任务、确认AI文案文件和网站风格映射。</div>`}
    ${skippedRows ? `
      <div class="site-group-card">
        <div class="site-group-head"><b>跳过/待配置</b><span>${escapeHtml(String(skipped.length))} 条</span></div>
        <div class="site-skipped-list">${skippedRows}</div>
      </div>
    ` : ""}
  `;
}

function statusClass(value) {
  const text = String(value || "");
  if (text.includes("failed") || text.includes("失败")) return "status-error";
  if (text.includes("waiting") || text.includes("等待") || text.includes("pending") || text.includes("待确认") || text.includes("排队中") || text.includes("上传中") || text.includes("accepted") || text.includes("partial") || text.includes("submitting") || text.includes("提交中") || text.includes("dry_run")) return "status-warn";
  if (text.includes("done") || text.includes("完成") || text.includes("classified") || text.includes("submitted") || text.includes("已提交")) return "status-ok";
  return "";
}

function taskIsProblem(task) {
  const text = [
    task.status,
    task.original_status,
    task.ai_status,
    task.classify_status,
    task.error,
  ].filter(Boolean).join(" ").toLowerCase();
  return text.includes("failed") || text.includes("失败") || text.includes("waiting") || text.includes("等待") || text.includes("partial");
}

function updateSelectedCount() {
  const count = state.selectedIds.size;
  $("selectedCount").textContent = `已选 ${count} 个`;
  const allBox = $("selectAllTasks");
  if (allBox) {
    allBox.checked = Boolean(state.tasks.length) && state.tasks.every((task) => state.selectedIds.has(String(task.id || "")));
    allBox.indeterminate = count > 0 && !allBox.checked;
  }
}

function originalStatusText(task) {
  if (task.original_status === "done") return `${task.original_chars || 0}字`;
  if (task.original_status === "process_failed") {
    return `已抓取${task.original_raw_chars ? ` ${task.original_raw_chars}字` : ""} / 规则失败`;
  }
  if (task.original_raw_status === "done" && String(task.original_status || "").includes("failed")) {
    return `已抓取${task.original_raw_chars ? ` ${task.original_raw_chars}字` : ""} / 规则失败`;
  }
  if (task.original_raw_status === "done") {
    return `已抓取${task.original_raw_chars ? ` ${task.original_raw_chars}字` : ""} / 待处理`;
  }
  return taskStatusText(task.original_status, "未抓取");
}

function taskStatusText(value, fallback = "") {
  const text = String(value || "").trim();
  const labels = {
    created: "待处理", queued: "等待处理", running: "处理中", classified: "已完成判断", classifying: "正在判断", classify_failed: "判断失败",
    fetching: "正在抓取", fetched: "已抓取", done: "已完成", original_done: "原文已就绪", original_failed: "原文抓取失败",
    generating: "正在生成", generated: "已生成", ai_done: "AI文案已生成", ai_failed: "AI生成失败", process_failed: "处理失败",
    waiting_ai_config: "等待 AI 配置", waiting_original: "等待原文", waiting_classifier_config: "等待分类模型配置",
    queued: "排队中", uploading: "上传中", submitted: "已提交", accepted_pending: "已接收，待确认", failed: "失败", waiting_config: "等待配置", skipped: "已跳过", interrupted: "已中断"
  };
  return labels[text] || text || fallback;
}

function taskDateKey(task) {
  const value = task.updated_at || task.updatedAt || task.created_at || task.createdAt || "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayDateKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function renderTasks(tasks) {
  const selectedDate = state.taskDate || todayDateKey();
  state.taskDate = selectedDate;
  if ($("taskDateFilter")) $("taskDateFilter").value = selectedDate;
  state.tasks = (tasks || []).filter((task) => taskDateKey(task) === selectedDate);
  const visibleIds = new Set(state.tasks.map((task) => String(task.id || "")));
  state.selectedIds = new Set([...state.selectedIds].filter((id) => visibleIds.has(id)));
  const body = $("tasksBody");
  body.innerHTML = "";
  if (!state.tasks.length) {
    body.innerHTML = `<tr><td colspan="12">${selectedDate === todayDateKey() ? "今日暂无任务" : `${selectedDate} 暂无任务`}</td></tr>`;
    updateSelectedCount();
    return;
  }
  for (const task of state.tasks) {
    const id = String(task.id || "");
    const sensitiveRunning = state.sensitiveProcessingIds.has(id);
    const sensitiveHits = Number(task.sensitive_hit_count || 0);
    const sensitiveFixed = Number(task.sensitive_fixed_count || 0);
    const sensitiveFailed = Number(task.sensitive_failed_count || 0);
    const sensitiveLabel = sensitiveRunning
      ? `<span class="task-spinner" aria-hidden="true"></span>敏感词执行中…`
      : sensitiveHits > 0
        ? `敏感日志 ${sensitiveHits}/${sensitiveFixed}${sensitiveFailed ? `/${sensitiveFailed}` : ""}`
        : "无敏感词命中";
    const tr = document.createElement("tr");
    const originalText = originalStatusText(task);
    const selectedAi = asArray(task.selected_versions).filter(version => /^ai[1-5]$/.test(version));
    const generatedAi = asArray(task.ai_files);
    const aiText = selectedAi.length
      ? `${generatedAi.map(version => version.toUpperCase()).join("、") || "待生成"}（${generatedAi.length}/${selectedAi.length}）`
      : "本次未选择 AI 文案";
    const siteText = siteSubmitText(task);
    tr.innerHTML = `
      <td><input class="task-check" type="checkbox" data-id="${escapeHtml(id)}" ${state.selectedIds.has(id) ? "checked" : ""} /></td>
      <td class="id-cell"><button class="task-id-link" data-action="detail" data-id="${escapeHtml(id)}" title="查看任务详情">${escapeHtml(id)}</button></td>
      <td>${escapeHtml(task.book_name || "")}</td>
      <td>${escapeHtml(task.platform_name || "")}</td>
      <td>${escapeHtml(task.style || "")}</td>
      <td>${escapeHtml(task.gender || "")}</td>
      <td class="${statusClass(task.classify_status)}">${escapeHtml(taskStatusText(task.classify_status, task.classifier_model ? "已完成判断" : "待判断"))}</td>
      <td class="${statusClass(task.original_status)}">${escapeHtml(originalText)}</td>
      <td class="${statusClass(task.ai_status)}">${escapeHtml(aiText)}</td>
      <td class="${statusClass(siteText)}">${escapeHtml(siteText)}</td>
      <td class="${statusClass(task.status)}">${escapeHtml(taskStatusText(task.status, "待处理"))}</td>
      <td class="task-actions">
        <button data-action="detail" data-id="${escapeHtml(id)}">查看</button>
        <button data-action="fetch" data-id="${escapeHtml(id)}">抓原文</button>
        <button data-action="ai" data-id="${escapeHtml(id)}">生成AI</button>
        <button data-action="sensitive" data-id="${escapeHtml(id)}" ${sensitiveRunning ? "disabled" : ""}>${sensitiveLabel}</button>
        <button data-action="siteLog" data-id="${escapeHtml(id)}">提交日志</button>
      </td>
    `;
    body.appendChild(tr);
  }
  updateSelectedCount();
}

function renderDetail(data) {
  const meta = data.meta || {};
  $("detailTitle").textContent = meta.book_id || meta.id || "详情";
  const knowledgeHistory = meta.rewrite_knowledge_history || [];
  const sensitiveFixed = data.sensitive_fixed || {};
  const sensitiveItems = asArray(sensitiveFixed.items).filter((item) => item && item.status === "done");
  const sensitiveRows = sensitiveItems.map((item) => `
    <div class="meta-item">
      <b>${escapeHtml(`敏感词${item.hit_index || ""}`)}</b>
      <span>${escapeHtml(item.keyword || "")}</span>
    </div>
  `).join("");
  const aiBlocks = (data.ai_texts || []).map((item) => `
    <div class="text-block">
      <h3>${escapeHtml(item.name)}</h3>
      <pre>${escapeHtml(item.text || "")}</pre>
    </div>
  `).join("");
  const knowledge = meta.rewrite_knowledge || {};
  const knowledgeRows = knowledgeHistory.map((item) => `
    <div class="meta-item">
      <b>${escapeHtml(`AI${item.ai_index || ""}`)}</b>
      <span>${escapeHtml(item.strategy_name || item.strategy || "")}${item.opening_phrase_name ? ` / ${escapeHtml(item.opening_phrase_name)}` : ""}${item.high_imitation_reference_name ? ` / ${escapeHtml(item.high_imitation_reference_name)}` : ""}</span>
    </div>
  `).join("");
  $("detail").className = "detail-box";
  $("detail").innerHTML = `
    <div class="meta-grid">
      ${metaItem("ID", meta.book_id || meta.id)}
      ${metaItem("书名", meta.book_name)}
      ${metaItem("平台", `${meta.platform_name || ""} ${meta.platform_id || ""}`)}
      ${metaItem("风格", meta.style)}
      ${metaItem("男女频", meta.gender)}
      ${metaItem("AI判断", taskStatusText(meta.classify_status))}
      ${metaItem("分类模型", meta.classifier_model)}
      ${metaItem("状态", taskStatusText(meta.status))}
      ${metaItem("原文字数", meta.original_chars || 0)}
      ${metaItem("敏感词处理", `${meta.sensitive_mode || ""} ${meta.sensitive_status || ""}`)}
      ${metaItem("命中/修复", `${meta.sensitive_hit_count || 0} / ${meta.sensitive_fixed_count || 0}`)}
      ${metaItem("AI状态", taskStatusText(meta.ai_status))}
      ${metaItem("改文模型", meta.rewrite_model)}
      ${metaItem("改文方案", knowledge.strategy_name || knowledge.strategy || "")}
      ${metaItem("改文模板", knowledge.rewrite_template_name || "")}
      ${metaItem("开头词", knowledge.opening_phrase_name || "")}
      ${metaItem("高仿参考", knowledge.high_imitation_reference_name || "")}
    </div>
    ${knowledgeRows ? `<div class="meta-grid">${knowledgeRows}</div>` : ""}
    ${sensitiveRows ? `<div class="meta-grid">${sensitiveRows}</div>` : ""}
    <div class="actions">
      <button id="detailPrevBtn" ${adjacentTaskId(-1) ? "" : "disabled"}>上一条</button>
      <button id="detailNextBtn" ${adjacentTaskId(1) ? "" : "disabled"}>下一条</button>
      <button id="detailCloseBtn">关闭</button>
      <button id="detailFetchBtn">重新抓原文</button>
      <button id="detailAiBtn">生成AI文案</button>
      <button id="detailTraceBtn">规则追踪</button>
      <button id="detailSensitiveBtn">重跑敏感词（当前文案）</button>
      ${data.has_original_raw ? `<button id="detailRestoreBtn">从备份恢复原文</button>` : ""}
    </div>
    <div class="text-block">
      <h3>处理后原文</h3>
      <pre>${escapeHtml(data.original || "")}</pre>
    </div>
    ${aiBlocks}
  `;
  $("detailCloseBtn").onclick = closeTaskDetail;
  $("detailPrevBtn").onclick = () => { const id = adjacentTaskId(-1); if (id) showTask(id); };
  $("detailNextBtn").onclick = () => { const id = adjacentTaskId(1); if (id) showTask(id); };
  $("detailFetchBtn").onclick = () => refetchTask(meta.book_id || meta.id);
  $("detailAiBtn").onclick = () => generateAi(meta.book_id || meta.id);
  $("detailTraceBtn").onclick = () => showRulesTrace(meta.book_id || meta.id);
  $("detailSensitiveBtn").onclick = () => reprocessSensitive([meta.book_id || meta.id], false);
  const restoreBtn = $("detailRestoreBtn");
  if (restoreBtn) restoreBtn.onclick = () => restoreOriginal(meta.book_id || meta.id);
}

function renderSensitiveLog(data) {
  const meta = data.meta || {};
  const hitsData = data.sensitive_hits || {};
  const fixedData = data.sensitive_fixed || {};
  const hits = asArray(hitsData.hits);
  const fixedItems = asArray(fixedData.items);
  const fixedByIndex = new Map(fixedItems.map((item) => [String(item.hit_index || ""), item]));
  const rows = hits.map((hit) => {
    const fixed = fixedByIndex.get(String(hit.hit_index || "")) || {};
    const status = fixed.status || fixedData.status || hitsData.status || "";
    return `
      <div class="sensitive-log-card">
        <div class="sensitive-log-head">
          <b>#${escapeHtml(hit.hit_index || "")} ${escapeHtml(hit.keyword || "")}</b>
          <span class="${statusClass(status)}">${escapeHtml(status || "命中")}</span>
        </div>
        <div class="meta-grid compact">
          ${metaItem("命中位置", `${hit.start ?? ""} - ${hit.end ?? ""}`)}
          ${metaItem("处理模型", fixed.model || "")}
          ${metaItem("尝试次数", fixed.attempt || "")}
          ${metaItem("错误", fixed.error || "")}
        </div>
        <div class="compare-grid">
          <div class="text-block">
            <h3>命中片段</h3>
            <pre>${escapeHtml(hit.snippet || fixed.before || "")}</pre>
          </div>
          <div class="text-block">
            <h3>AI替换结果</h3>
            <pre>${escapeHtml(fixed.after || "暂无AI替换内容")}</pre>
          </div>
        </div>
      </div>
    `;
  }).join("");
  const eventRows = asArray(data.logs).map((item) => `
    <div class="log-row">
      <code>${escapeHtml(item.time || "")}</code>
      ${escapeHtml(item.event || item.raw || "")}
      ${item.data ? `<pre>${escapeHtml(JSON.stringify(item.data, null, 2))}</pre>` : ""}
    </div>
  `).join("");
  $("detailTitle").textContent = `${meta.book_id || meta.id || "任务"} 敏感日志`;
  $("detail").className = "detail-box";
  $("detail").innerHTML = `
    <div class="meta-grid">
      ${metaItem("ID", meta.book_id || meta.id)}
      ${metaItem("书名", meta.book_name || "")}
      ${metaItem("处理模式", hitsData.mode || fixedData.mode || meta.sensitive_mode || "")}
      ${metaItem("处理状态", hitsData.status || fixedData.status || meta.sensitive_status || "")}
      ${metaItem("命中数量", hitsData.hit_count ?? meta.sensitive_hit_count ?? hits.length)}
      ${metaItem("AI修复数量", fixedData.fixed_count ?? meta.sensitive_fixed_count ?? fixedItems.length)}
      ${metaItem("命中更新时间", hitsData.updated_at || "")}
      ${metaItem("替换更新时间", fixedData.updated_at || "")}
    </div>
    ${rows || `<div class="detail-empty small">暂无敏感词命中记录。抓取原文或规则处理后，如果命中敏感词，会在这里显示命中片段和 AI 替换结果。</div>`}
    <div class="text-block">
      <h3>相关处理日志</h3>
      <div class="logs-list">${eventRows || `<div class="log-row">暂无相关日志</div>`}</div>
    </div>
  `;
}

function renderRulesTrace(data) {
  const meta = data.meta || {};
  const stages = asArray(data.stages);
  const rows = stages.map((stage, index) => {
    const samples = asArray(stage.samples).map((sample) => `
      <div class="log-row">
        <b>第 ${escapeHtml(sample.line || "")} 行</b>
        <div class="compare-grid">
          <div class="text-block">
            <h3>处理前</h3>
            <pre>${escapeHtml(sample.before || "")}</pre>
          </div>
          <div class="text-block">
            <h3>处理后</h3>
            <pre>${escapeHtml(sample.after || "")}</pre>
          </div>
        </div>
      </div>
    `).join("");
    return `
      <div class="text-block">
        <h3>${index + 1}. ${escapeHtml(stage.title || stage.name || "")}</h3>
        <div class="meta-grid compact">
          ${metaItem("字数", stage.chars ?? 0)}
          ${metaItem("行数", stage.lines ?? 0)}
          ${metaItem("是否改动", stage.changed ? "有改动" : "无改动")}
        </div>
        ${samples ? `<div>${samples}</div>` : `<div class="detail-empty small">这一步没有产生可见改动。</div>`}
        <pre>${escapeHtml(stage.preview || "")}</pre>
      </div>
    `;
  }).join("");
  $("detailTitle").textContent = `${meta.book_id || meta.id || "任务"} 规则追踪`;
  $("detail").className = "detail-box";
  $("detail").innerHTML = `
    <div class="meta-grid">
      ${metaItem("ID", meta.book_id || meta.id)}
      ${metaItem("书名", meta.book_name || "")}
      ${metaItem("追踪来源", data.source || "")}
      ${metaItem("来源字数", data.source_chars || 0)}
      ${metaItem("当前原文字数", data.saved_original_chars || 0)}
      ${metaItem("说明", "只追踪系统规则，不触发AI改文")}
    </div>
    ${rows || `<div class="detail-empty small">暂无规则追踪内容。</div>`}
  `;
}

function renderSiteSubmitLog(data) {
  const meta = data.meta || {};
  const result = data.result || {};
  const versions = result.versions || {};
  const savedVersions = Object.keys(versions).length ? versions : asArray(data.logs).reduce((result, entry) => {
    const version = entry?.version || entry?.data?.version;
    if (version) result[version] = { ...(entry?.data || entry), status: entry?.status || entry?.data?.status || "" };
    return result;
  }, {});
  const versionRows = Object.keys(savedVersions).map((key) => {
    const item = savedVersions[key] || {};
    const traceRows = asArray(item.execution_trace).map((entry) => `
      <div class="site-skipped-row submit-trace-row">
        <code>${escapeHtml(entry.step || "执行步骤")}</code>
        <span class="${statusClass(entry.status)}">${escapeHtml(entry.status || "")}</span>
        <span>${escapeHtml(entry.detail || "")}</span>
        <time>${escapeHtml(entry.time || "")}</time>
      </div>
    `).join("");
    const receipt = item.remote_receipt || {};
    const remote = receipt.remote_record || {};
    return `
      <div class="sensitive-log-card">
        <div class="sensitive-log-head">
          <b>${escapeHtml(key)}</b>
          <span class="${statusClass(item.status)}">${escapeHtml(item.status || "")}</span>
        </div>
        <div class="meta-grid compact">
          ${metaItem("提交组", item.group_id || "")}
          ${metaItem("文件", item.file || "")}
          ${metaItem("更新时间", item.updated_at || item.time || "")}
          ${metaItem("素材分配", item.material_allocation ? `解压 ${item.material_allocation.jieyaNum ?? 0} / 滚屏 ${item.material_allocation.gunpingNum ?? 0}` : "")}
          ${metaItem("错误", item.error || "")}
          ${metaItem("121记录", remote.found ? `已找到 #${remote.remote_id || ""}` : remote.detail || "未核验")}
        </div>
        ${traceRows ? `<div class="text-block submit-trace"><h3>执行链路</h3><div class="site-skipped-list">${traceRows}</div></div>` : ""}
        ${item.remote_receipt ? `<details class="submit-receipt"><summary>查看 121 原始回执</summary><pre class="site-output">${escapeHtml(JSON.stringify(item.remote_receipt, null, 2))}</pre></details>` : ""}
        ${item.profile ? `<pre class="site-output">${escapeHtml(JSON.stringify(item.profile, null, 2))}</pre>` : ""}
      </div>
    `;
  }).join("");
  const eventRows = asArray(data.logs).map((item) => `
    <div class="log-row">
      <code>${escapeHtml(item.time || "")}</code>
      ${escapeHtml(item.event || item.raw || "")}
      ${item.data ? `<pre>${escapeHtml(JSON.stringify(item.data, null, 2))}</pre>` : ""}
    </div>
  `).join("");
  $("detailTitle").textContent = `${meta.book_id || meta.id || "任务"} 网站提交日志`;
  $("detail").className = "detail-box";
  $("detail").innerHTML = `
    <div class="meta-grid">
      ${metaItem("ID", meta.book_id || meta.id)}
      ${metaItem("书名", meta.book_name || "")}
      ${metaItem("平台", `${meta.platform_name || ""} ${meta.platform_id || ""}`)}
      ${metaItem("风格", meta.style || "")}
      ${metaItem("男女频", meta.gender || "")}
      ${metaItem("总状态", result.status || "未提交")}
      ${metaItem("最后提交组", result.last_group_id || "")}
      ${metaItem("错误", result.error || "")}
    </div>
    ${versionRows || `<div class="detail-empty small">暂无网站提交记录。提交后会显示每个版本的状态和对应上传组。</div>`}
    <div class="text-block">
      <h3>上传过程日志</h3>
      <div class="logs-list">${eventRows || `<div class="log-row">暂无相关日志</div>`}</div>
    </div>
  `;
}

function metaItem(label, value) {
  return `<div class="meta-item"><b>${escapeHtml(label)}</b><span>${escapeHtml(String(value || ""))}</span></div>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function loadConfig() {
  state.config = await api("/api/config");
  renderConfig();
}

async function loadTasks() {
  const data = await api("/api/tasks");
  renderTasks(data.tasks || []);
  $("summaryText").textContent = `${state.taskDate} 显示 ${state.tasks.length} 个任务；历史任务可切换日期查看`;
}

async function refreshTasksAndSubmitHistory() {
  setBatchStatus("正在刷新任务和网站提交记录...");
  try {
    await Promise.all([loadTasks(), loadWebSubmitHistory()]);
    setBatchStatus("任务和网站提交记录已更新");
  } catch (error) {
    setBatchStatus(`刷新失败：${error.message || "请稍后重试"}`);
  }
}

async function loadLogs() {
  const data = await api("/api/logs");
  const list = $("logsList");
  list.innerHTML = "";
  for (const item of (data.logs || [])) {
    const div = document.createElement("div");
    div.className = "log-row";
    div.innerHTML = `<code>${escapeHtml(item.book_id || "")}</code> ${escapeHtml(item.time || "")} ${escapeHtml(item.event || "")}<br>${escapeHtml(JSON.stringify(item.data || item.raw || {}, null, 0))}`;
    list.appendChild(div);
  }
  if (!list.innerHTML) list.textContent = "暂无日志";
}

async function loadRecords() {
  await Promise.all([loadWebSubmitHistory(), loadLogs()]);
}

function renderProcessResult(result) {
  const lines = [
    "处理完成",
    `读取行数：${result.parsed || 0}`,
    `有效任务：${result.unique_tasks || 0}`,
    `重复ID：${result.duplicate_count || 0}`,
    `空ID行：${result.empty_id_count || 0}`,
    `raw原文抓到：${result.raw_fetched || 0}`,
    `原文处理成功：${result.fetched || 0}`,
    `系统规则/敏感词处理失败：${result.process_failed || 0}`,
    `接口抓取失败：${result.fetch_failed || 0}`,
    `AI文案：${result.generated_ai_files || 0}`,
    `AI文案生成失败：${result.rewrite_failed || 0}`,
  ];
  if (result.style_sync?.style_sync) {
    lines.push(`网站风格同步：新增 ${result.style_sync.style_sync.added?.length || 0}，删除 ${result.style_sync.style_sync.removed?.length || 0}`);
  } else if (result.style_sync?.error) {
    lines.push(`网站风格同步失败：${result.style_sync.error}`);
  }
  if (result.site_submit?.requested !== undefined) {
    lines.push(`网站提交：提交组 ${result.site_submit.group_count || 0}，成功 ${result.site_submit.success_groups || 0}，失败 ${result.site_submit.failed_groups || 0}`);
  } else if (result.site_submit?.error) {
    lines.push(`网站提交失败：${result.site_submit.error}`);
  }
  if (result.classify_errors?.length) {
    lines.push(`分类提示：${result.classify_errors.join("；")}`);
  }
  const steps = Array.isArray(result.steps) ? result.steps : [];
  if (steps.length) {
    lines.push("", "执行明细：");
    steps.forEach((item, index) => {
      const label = {
        done: "完成",
        warning: "注意",
        failed: "失败",
        skipped: "跳过",
      }[item.status] || item.status || "状态";
      lines.push(`${index + 1}. ${label}：${item.message || ""}`);
    });
  }
  lines.push("", "任务列表已刷新，可切换到“任务”查看每个ID。");
  return lines.filter((line) => line !== "").join("\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderProcessJob(job) {
  if (job.result) return renderProcessResult(job.result);
  const lines = [
    `处理中：${job.id || ""}`,
    `状态：${job.status || "running"}`,
  ];
  const steps = Array.isArray(job.steps) ? job.steps : [];
  if (steps.length) {
    lines.push("", "实时进度：");
    steps.forEach((item, index) => {
      const label = {
        done: "完成",
        running: "执行中",
        warning: "注意",
        failed: "失败",
        skipped: "跳过",
      }[item.status] || item.status || "状态";
      lines.push(`${index + 1}. ${label}：${item.message || ""}`);
    });
  } else {
    lines.push("", "正在准备执行...");
  }
  if (job.error) lines.push("", `错误：${job.error}`);
  return lines.join("\n");
}

async function restoreLatestProcessJob() {
  const box = $("processResult");
  if (!box) return;
  try {
    const data = await api("/api/process/jobs/latest");
    const job = data.latest || {};
    if (!job.id) {
      if (!box.textContent.trim()) box.textContent = "暂无处理记录。";
      return;
    }
    state.activeProcessJobId = job.id;
    box.textContent = renderProcessJob(job);
    if (job.status === "running") {
      const result = await pollProcessJob(job.id);
      if (state.activeProcessJobId === job.id) {
        box.textContent = renderProcessResult(result);
        if (result.tasks) renderTasks(result.tasks || []);
      }
    }
  } catch (error) {
    if (!box.textContent.trim()) box.textContent = "最近处理记录读取失败：" + error.message;
  }
}

async function pollProcessJob(jobId) {
  let latest = null;
  const startedAt = Date.now();
  for (;;) {
    latest = await api(`/api/process/jobs/${encodeURIComponent(jobId)}`);
    $("processResult").textContent = renderProcessJob(latest);
    if (latest.status === "done") return latest.result || {};
    if (latest.status === "failed") throw new Error(latest.error || "处理失败");
    if (Date.now() - startedAt >= PROCESS_JOB_TIMEOUT_MS) {
      throw new Error("处理任务超过 10 分钟仍未完成，请到“任务”页刷新并查看状态");
    }
    await sleep(1000);
  }
}

async function processInput() {
  const button = $("processBtn");
  const versions = selectedProcessVersions();
  if (!versions.length) {
    $("processResult").textContent = "请至少选择一个文案版本；请打开版本对应配置档勾选版本。";
    openVersionConfigCard();
    return;
  }
  button.disabled = true;
  try {
    await saveWorkFormStateNow();
    await saveWebSubmitConfig(true);
    $("processResult").textContent = [
      "处理中...",
      "1. 正在读取版本配置",
      "2. 正在补齐缺失的风格类型/男女频",
      "3. 正在按所选平台抓取原文",
      "4. 正在生成所选文案并执行处理规则",
    ].join("\n");
    const payload = {
      platform_id: $("platformSelect").value,
      input_text: $("inputText").value,
      selected_versions: versions,
      ai_slot_methods: processAiMethods(),
      profile_bindings: webProfileBindingsFromForm(),
      sensitive_ai_enabled: sensitiveAiProcessEnabled(),
    };
    const job = await api("/api/process/start", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.activeProcessJobId = job.id;
    $("processResult").textContent = renderProcessJob(job);
    const result = await pollProcessJob(job.id);
    $("processResult").textContent = renderProcessResult(result);
    renderTasks(result.tasks || []);
  } catch (error) {
    $("processResult").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function showTask(id) {
  state.selectedId = id;
  const data = await api(`/api/tasks/${id}`);
  renderDetail(data);
  activateTab("tasks");
  document.body.classList.add("detail-modal-open");
  focusTaskDetail();
}

function closeTaskDetail() { document.body.classList.remove("detail-modal-open"); }

function adjacentTaskId(direction) {
  const index = state.tasks.findIndex((task) => String(task.id || "") === String(state.selectedId || ""));
  const next = index + direction;
  return next >= 0 && next < state.tasks.length ? String(state.tasks[next].id || "") : "";
}

function focusTaskDetail() {
  requestAnimationFrame(() => $("detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

async function showSensitiveLog(id) {
  state.selectedId = id;
  const data = await api(`/api/tasks/${id}/sensitive-log`);
  renderSensitiveLog(data);
  activateTab("tasks");
  document.body.classList.add("detail-modal-open");
  focusTaskDetail();
}

async function showRulesTrace(id) {
  state.selectedId = id;
  const data = await api(`/api/tasks/${id}/rules-trace`);
  renderRulesTrace(data);
  activateTab("tasks");
  document.body.classList.add("detail-modal-open");
  focusTaskDetail();
}

async function showSiteSubmitLog(id) {
  state.selectedId = id;
  const data = await api(`/api/tasks/${id}/site-submit-log`);
  renderSiteSubmitLog(data);
  activateTab("tasks");
  document.body.classList.add("detail-modal-open");
  focusTaskDetail();
}

async function refetchTask(id) {
  if (!id) return;
  await api(`/api/tasks/${id}/fetch`, {
    method: "POST",
    body: JSON.stringify({ sensitive_ai_enabled: sensitiveAiProcessEnabled() }),
  });
  await loadTasks();
  await showTask(id);
}

async function restoreOriginal(id) {
  if (!id) return;
  if (!confirm("确认从备份恢复原文？恢复时会自动重新套用系统处理规则。")) return;
  await api(`/api/tasks/${id}/restore-original`, {
    method: "POST",
    body: JSON.stringify({ sensitive_ai_enabled: sensitiveAiProcessEnabled() }),
  });
  await loadTasks();
  await showTask(id);
}

async function generateAi(id) {
  if (!id) return;
  const task = state.tasks.find(item => String(item.id || item.book_id || "") === String(id));
  const selectedVersions = asArray(task?.selected_versions).length ? task.selected_versions : selectedProcessVersions();
  await api(`/api/tasks/${id}/generate-ai`, {
    method: "POST",
    body: JSON.stringify({ selected_versions: selectedVersions, ai_slot_methods: task?.ai_slot_methods || processAiMethods(), sensitive_ai_enabled: sensitiveAiProcessEnabled() }),
  });
  await loadTasks();
  await showTask(id);
}

function selectedTaskIds() {
  return [...state.selectedIds];
}

function setBatchStatus(text) {
  $("batchStatus").textContent = text || "";
}

async function platformApi(path, options = {}) {
  const token = localStorage.getItem("auth_token") || "";
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

async function transferSelectedToBatchFactory() {
  const ids = selectedTaskIds();
  if (!ids.length) {
    setBatchStatus("先选择要转入批量工厂的任务");
    return;
  }
  const button = $("transferBatchFactoryBtn");
  button.disabled = true;
  setBatchStatus(`正在检查 ${ids.length} 个任务的原文…`);
  try {
    const details = await Promise.all(ids.map(id => api(`/api/tasks/${encodeURIComponent(id)}`)));
    const items = details.flatMap((detail, index) => {
      const meta = detail?.meta || {};
      const sourceText = String(detail?.original || "").trim();
      if (!sourceText) return [];
      const sourceTaskId = String(meta.book_id || ids[index]).trim();
      const bookId = String(meta.book_id || ids[index]).trim();
      if (!sourceTaskId || !bookId) return [];
      return [{
        sourceTaskId,
        bookId,
        title: String(meta.book_name || bookId).trim(),
        platform: String(meta.platform_name || "").trim(),
        sourceText,
        txtText: sourceText,
        sourceMetadata: meta,
      }];
    });
    const skipped = ids.length - items.length;
    if (!items.length) throw new Error("选中的任务都没有可用原文，请先完成原文获取");
    const result = await platformApi("/api/batch-factory/v11/intakes/novel-fetch", {
      method: "POST",
      body: JSON.stringify({
        books: items.map(item => ({
          id: item.bookId,
          bookId: item.bookId,
          sourceTaskId: item.sourceTaskId,
          title: item.title,
          platform: item.platform,
          sourceText: item.sourceText,
          txtText: item.txtText,
          txtFileName: `${item.bookId}.txt`,
          sourceMetadata: item.sourceMetadata,
        })),
        metadata: {
          name: `小说获取转入 ${items.length} 本`,
          source: "novel-fetch",
          transferredAt: new Date().toISOString(),
        },
      }),
    });
    const intakeId = String(result?.intake?.id || "").trim();
    const redirectTo = result.redirectTo || (intakeId ? `/batch-factory?intake=${encodeURIComponent(intakeId)}` : "");
    if (!redirectTo) throw new Error("V11 Intake 创建成功但未返回跳转地址");
    setBatchStatus(`已转入 ${items.length} 本${skipped ? `, 跳过 ${skipped} 本未完成任务` : ""}`);
    window.parent.postMessage({ type: "qiantie:batch-factory-intake", redirectTo }, window.location.origin);
  } catch (error) {
    setBatchStatus(error.message || "转入批量工厂失败");
  } finally {
    button.disabled = false;
  }
}

let batchToastTimer = null;
function showBatchToast(text, type = "success") {
  if (window.parent !== window) {
    window.parent.postMessage({
      type: "qiantie:task-notification",
      source: "小说获取",
      status: type === "warning" || type === "error" ? "error" : "success",
      title: type === "warning" || type === "error" ? "小说获取任务需要处理" : "小说获取任务已完成",
      detail: String(text || "").replace(/\s+/g, " ").trim().slice(0, 280),
      page: "小说获取",
      pagePath: "/novel-fetch",
    }, "*");
  }
  let toast = $("batchToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "batchToast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  toast.className = `batch-toast ${type}`;
  toast.textContent = text || "";
  requestAnimationFrame(() => toast.classList.add("visible"));
  clearTimeout(batchToastTimer);
  batchToastTimer = setTimeout(() => toast.classList.remove("visible"), 4200);
}

async function batchDelete(mode) {
  const ids = mode === "selected" ? selectedTaskIds() : [];
  if (mode === "selected" && !ids.length) {
    setBatchStatus("先选择任务");
    return;
  }
  const label = mode === "all" ? "全部任务" : (mode === "failed" ? "失败任务" : `${ids.length} 个选中任务`);
  if (!confirm(`确认删除${label}？会删除对应 ID 的本地内容文件。`)) return;
  setBatchStatus("删除中...");
  try {
    const result = await api("/api/tasks/batch-delete", {
      method: "POST",
      body: JSON.stringify({ mode, ids }),
    });
    state.selectedIds.clear();
    if (state.selectedId && !(result.tasks || []).some((task) => String(task.id) === String(state.selectedId))) {
      state.selectedId = "";
      $("detailTitle").textContent = "未选择";
      $("detail").className = "detail-empty";
      $("detail").textContent = "在“任务”页点击书籍 ID 或“查看”，这里会展示该书的原文、AI 文案、处理规则和提交记录。";
    }
    renderTasks(result.tasks || []);
    setBatchStatus(`已删除 ${result.deleted || 0} 个，失败 ${result.failed || 0} 个`);
  } catch (error) {
    setBatchStatus(error.message);
  }
}

async function batchRetry(mode) {
  const ids = mode === "selected" ? selectedTaskIds() : [];
  if (mode === "selected" && !ids.length) {
    setBatchStatus("先选择任务");
    return;
  }
  const label = mode === "failed" ? "失败任务" : `${ids.length} 个选中任务`;
  setBatchStatus(`重试${label}中...`);
  try {
    const result = await api("/api/tasks/batch-retry", {
      method: "POST",
      body: JSON.stringify({ mode, ids, sensitive_ai_enabled: sensitiveAiProcessEnabled() }),
    });
    renderTasks(result.tasks || []);
    setBatchStatus(`已重试 ${result.retried || 0} 个，失败 ${result.failed || 0} 个`);
  } catch (error) {
    setBatchStatus(error.message);
  }
}

async function applyRules(mode) {
  const ids = mode === "selected" ? selectedTaskIds() : [];
  if (mode === "selected" && !ids.length) {
    setBatchStatus("先选择任务");
    return;
  }
  const label = mode === "all" ? "全部任务" : `${ids.length} 个选中任务`;
  setBatchStatus(`规则处理${label}中...`);
  try {
    const result = await api("/api/tasks/apply-rules", {
      method: "POST",
      body: JSON.stringify({
        mode,
        ids,
        scope: $("ruleApplyScope").value || "both",
        sensitive_ai_enabled: sensitiveAiProcessEnabled(),
      }),
    });
    renderTasks(result.tasks || []);
    setBatchStatus(`规则处理完成 ${result.applied || 0} 个，失败 ${result.failed || 0} 个`);
  } catch (error) {
    setBatchStatus(error.message);
  }
}

async function reprocessSensitive(ids, restoreFromBackup) {
  const selected = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!selected.length) {
    setBatchStatus("先选择任务");
    return;
  }
  if (restoreFromBackup && !confirm("将从原文备份恢复后，按当前敏感词规则重新处理。当前处理后原文会被覆盖，是否继续？")) return;
  const label = restoreFromBackup ? "从备份重跑敏感词" : "重跑敏感词";
  let processed = 0;
  let restored = 0;
  let failed = 0;
  let latestTasks = state.tasks;
  let firstError = "";
  for (let index = 0; index < selected.length; index += 1) {
    const id = selected[index];
    state.sensitiveProcessingIds.add(id);
    setBatchStatus(`${label}中：第 ${index + 1}/${selected.length} 条`);
    renderTasks(latestTasks);
    try {
      const result = await api("/api/tasks/reprocess-sensitive", {
        method: "POST",
        body: JSON.stringify({
          ids: [id],
          restore_from_backup: restoreFromBackup,
          sensitive_ai_enabled: sensitiveAiProcessEnabled(),
        }),
      });
      processed += Number(result.processed || 0);
      restored += Number(result.restored || 0);
      failed += Number(result.failed || 0);
      latestTasks = result.tasks || latestTasks;
    } catch (error) {
      failed += 1;
      firstError ||= error.message || "请求失败";
    } finally {
      state.sensitiveProcessingIds.delete(id);
      renderTasks(latestTasks);
    }
  }
  const summary = `${label}完成：已处理 ${processed} 个${restoreFromBackup ? `，已恢复 ${restored} 个` : ""}，失败 ${failed} 个`;
  setBatchStatus(firstError ? `${summary}（${firstError}）` : summary);
  showBatchToast(firstError || failed ? `${summary}${firstError ? `：${firstError}` : ""}` : summary, failed ? "warning" : "success");
  if (state.selectedId && selected.includes(String(state.selectedId))) await showTask(state.selectedId);
}

async function startSensitiveProcessing() {
  const ids = state.tasks.map(task => String(task.id || '')).filter(Boolean);
  if (!ids.length) {
    setBatchStatus('当前没有可处理任务');
    return;
  }
  await reprocessSensitive(ids, false);
  await loadTasks();
}

function openWebSubmitFromTasks() {
  void submitWebSubmit("selected");
}

function selectAllVisibleTasks() {
  for (const task of state.tasks) {
    if (task.id) state.selectedIds.add(String(task.id));
  }
  renderTasks(state.tasks);
}

function clearSelectedTasks() {
  state.selectedIds.clear();
  renderTasks(state.tasks);
}

function syncFormToAppConfig() {
  const cfg = clone(state.config.app_config || {});
  cfg.workflow = {
    ...(cfg.workflow || {}),
    auto_classify_missing: $("workflowAutoClassify").checked,
    auto_fetch_original: $("workflowAutoFetch").checked,
    auto_rewrite_after_fetch: $("workflowAutoRewrite").checked,
    auto_submit_after_rewrite: false,
    auto_submit_confirmed: false,
  };
  cfg.sensitive_ai = {
    ...(cfg.sensitive_ai || {}),
    enabled: sensitiveAiProcessEnabled(),
  };
  cfg.fetch = {
    ...(cfg.fetch || {}),
    endpoint: $("fetchEndpoint").value.trim() || "https://txt.121w.com/api.php",
    default_max_txt: numberValue("fetchMaxTxt", 4000),
    concurrency: numberValue("fetchConcurrency", 4),
    retries: numberValue("fetchRetries", 1),
    timeout_seconds: numberValue("fetchTimeout", 30),
    auto_detect_platform: $("fetchAutoDetectPlatform").checked,
  };
  cfg.rewrite = {
    ...(cfg.rewrite || {}),
    process_line_count: numberValue("processLineCount", 5),
    anchor_line_count: numberValue("anchorLineCount", 5),
    temperature: numberValue("rewriteTemp", 0.45),
    method_sequence: $("methodSequenceInput").value.split(/[\s,，、|\/]+/).map((item) => item.trim()).filter(Boolean),
    default_template_id: $("rewriteTemplateSelect").value || "",
    opening_phrase_mode: $("openingPhraseMode").value || "auto",
    high_imitation_mode: $("highImitationMode").value || "auto",
    prompt: $("rewritePrompt").value,
    processing_rule_prompt: $("processingRulePrompt").value,
  };
  ensureKnowledgeConfig();
  state.config.knowledge.usage_prompt = $("knowledgeUsagePrompt")?.value || "";
  cfg.ai = readAiSettingsFromForm();
  cfg.ai_assignments = {
    classifier: $("classifierSelect").value || "__current__",
    rewrite: $("rewriteSelect").value || "__current__",
    sensitive_fix: $("sensitiveFixSelect")?.value || "__current__",
  };
  cfg.ai_presets = cfg.ai_presets || [];
  syncCurrentAiPreset(cfg);
  return cfg;
}

async function saveConfig(throwOnError = false) {
  $("configStatus").textContent = "保存中...";
  try {
    saveLibraryItem(true);
    saveRuleEditor(true);
    const appConfig = syncFormToAppConfig();
    const activePresetId = appConfig.ai_assignments?.rewrite === "preset_current_auto" ? "preset_current_auto" : "";
    const payload = {
      app_config: appConfig,
      platforms: JSON.parse($("platformsText").value),
      styles: JSON.parse($("stylesText").value),
      sensitive: state.config.sensitive || { groups: [] },
      knowledge: state.config.knowledge || {},
    };
    const data = await api("/api/config", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.config = data.config;
    renderConfig();
    if (activePresetId && $("presetSelect")) {
      $("presetSelect").value = activePresetId;
      $("presetName").value = state.config.app_config?.ai_presets?.find((item) => item?.id === activePresetId)?.name || "当前预设（自动同步）";
    }
    $("configStatus").textContent = activePresetId ? "已保存，并已更新当前预设" : "已保存";
    const knowledgeSave = $("knowledgeSaveStatus");
    if (knowledgeSave) knowledgeSave.textContent = "已保存";
    const rulesSave = $("rulesSaveStatus");
    if (rulesSave) rulesSave.textContent = "已保存";
    return data;
  } catch (error) {
    $("configStatus").textContent = error.message;
    if (throwOnError) throw error;
  }
}

async function saveCurrentPreset() {
  const cfg = syncFormToAppConfig();
  const presets = cfg.ai_presets || [];
  const selectedId = $("presetSelect").value;
  const name = $("presetName").value.trim() || $("aiModel").value.trim() || `预设${presets.length + 1}`;
  let id = selectedId && selectedId !== "" ? selectedId : `preset_${Date.now()}`;
  if (!presets.some((item) => item.id === id)) {
    id = `preset_${Date.now()}`;
  }
  const nextPreset = { ...readAiSettingsFromForm(), id, name };
  const index = presets.findIndex((item) => item.id === id);
  if (index >= 0) {
    presets[index] = nextPreset;
  } else {
    presets.push(nextPreset);
  }
  state.config.app_config = { ...cfg, ai_presets: presets };
  renderPresetControls(state.config.app_config);
  $("presetSelect").value = id;
  await saveConfig();
  $("configStatus").textContent = "预设已保存";
}

function applySelectedPreset() {
  const id = $("presetSelect").value;
  const preset = (state.config?.app_config?.ai_presets || []).find((item) => item.id === id);
  if (!preset) return;
  applyAiSettingsToForm(preset);
  $("presetName").value = preset.name || "";
  $("configStatus").textContent = "已应用预设，记得保存配置";
}

async function deleteSelectedPreset() {
  const id = $("presetSelect").value;
  if (!id) return;
  const cfg = syncFormToAppConfig();
  cfg.ai_presets = (cfg.ai_presets || []).filter((item) => item.id !== id);
  if (cfg.ai_assignments?.classifier === id) cfg.ai_assignments.classifier = "__current__";
  if (cfg.ai_assignments?.rewrite === id) cfg.ai_assignments.rewrite = "__current__";
  if (cfg.ai_assignments?.sensitive_fix === id) cfg.ai_assignments.sensitive_fix = "__current__";
  state.config.app_config = cfg;
  renderPresetControls(cfg);
  await saveConfig();
  $("configStatus").textContent = "预设已删除并保存";
}

async function testAi() {
  $("aiTestStatus").textContent = "测试中...";
  try {
    const settings = readAiSettingsFromForm();
    // 密钥可能不会回填到密码框。此时不能把空密钥覆盖到测试请求里，
    // 应改用服务端已保存、且已被“当前预设”选中的改文模型。
    const completeInForm = Boolean(settings.base_url && settings.api_key && settings.model);
    const result = await api("/api/ai/test", {
      method: "POST",
      body: JSON.stringify({
        purpose: "rewrite",
        ...(completeInForm ? { settings: { ...settings, baseUrl: settings.base_url, apiKey: settings.api_key } } : {}),
      }),
    });
    $("aiTestStatus").textContent = `成功：${result.content || "ok"}${completeInForm ? "" : "（已使用已保存的当前预设）"}`;
  } catch (error) {
    $("aiTestStatus").textContent = error.message;
  }
}

async function refreshKnowledge() {
  $("knowledgeStatus").textContent = "刷新中...";
  try {
    const result = await api("/api/knowledge");
    state.config.knowledge_summary = result.summary || {};
    renderKnowledgeSummary(state.config.knowledge_summary);
    renderRewriteTemplateOptions(state.config?.app_config?.rewrite?.default_template_id || "");
    $("knowledgeStatus").textContent = "已刷新";
  } catch (error) {
    $("knowledgeStatus").textContent = error.message;
  }
}

async function analyzeOpeningPhrase() {
  const button = $("openingAnalyzeBtn");
  const status = $("openingAnalyzeStatus");
  const resultBox = $("openingAnalyzeResult");
  button.disabled = true;
  status.textContent = "拆解中...";
  resultBox.value = "";
  state.pendingOpeningItem = null;
  try {
    const result = await api("/api/opening/analyze", {
      method: "POST",
      body: JSON.stringify({
        source_text: $("openingSourceText").value,
        style: $("openingAnalyzeStyle").value,
        extra_requirement: $("openingAnalyzeExtra").value,
      }),
    });
    state.pendingOpeningItem = result.item || null;
    resultBox.value = pretty(result.item || {});
    status.textContent = `已拆解${result.model ? `，模型：${result.model}` : ""}`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function saveAnalyzedOpeningPhrase() {
  const status = $("openingAnalyzeStatus");
  let item = state.pendingOpeningItem;
  if (!item) {
    try {
      item = JSON.parse($("openingAnalyzeResult").value || "{}");
    } catch {
      status.textContent = "拆解结果不是有效格式";
      return;
    }
  }
  if (!item || !item.content) {
    status.textContent = "没有可入库的开头词内容";
    return;
  }
  status.textContent = "入库中...";
  try {
    const result = await api("/api/opening/save", {
      method: "POST",
      body: JSON.stringify({ item }),
    });
    state.config = result.config || state.config;
    state.pendingOpeningItem = null;
    $("libraryTypeSelect").value = "opening_phrases";
    renderConfig();
    status.textContent = "已加入开头词库";
  } catch (error) {
    status.textContent = error.message;
  }
}

async function normalizeOpeningLibrary() {
  const status = $("knowledgeStatus");
  status.textContent = "矫正中...";
  try {
    const result = await api("/api/opening/normalize", { method: "POST" });
    state.config = result.config || state.config;
    $("libraryTypeSelect").value = "opening_phrases";
    renderConfig();
    status.textContent = `已矫正开头词库：${result.summary?.opening_phrases || 0} 条`;
  } catch (error) {
    status.textContent = error.message;
  }
}

function clearOpeningAnalyzer() {
  $("openingSourceText").value = "";
  $("openingAnalyzeExtra").value = "";
  $("openingAnalyzeResult").value = "";
  $("openingAnalyzeStatus").textContent = "";
  state.pendingOpeningItem = null;
}

async function previewRuleResult() {
  saveRuleEditor(true);
  const input = $("rulePreviewInput").value;
  $("rulePreviewOutput").value = "处理中...";
  try {
    await saveConfig();
    const result = await api("/api/rules/preview", {
      method: "POST",
      body: JSON.stringify({
        text: input,
        scope: $("ruleTypeSelect").value === "sensitive" ? "original" : "ai",
      }),
    });
    $("rulePreviewOutput").value = result.processed || "";
  } catch (error) {
    $("rulePreviewOutput").value = error.message;
  }
}

document.addEventListener("click", async (event) => {
  const loginStatus = event.target.closest("#webLoginStatus");
  if (loginStatus) {
    await openWebLoginDialog();
    return;
  }
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.ruleAction) {
    handleRuleAction(button.dataset.ruleAction);
    return;
  }
  if (button.classList.contains("tab")) {
    activateTab(button.dataset.tab);
    if (button.dataset.tab === "tasks") await refreshTasksAndSubmitHistory();
    if (button.dataset.tab === "knowledge") renderLibraryManager(Number($("libraryItemSelect")?.value || 0));
    if (button.dataset.tab === "rules") renderRuleEditor();
    if (button.dataset.tab === "logs") await loadRecords();
    return;
  }
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === "detail") await showTask(id);
  if (action === "fetch") await refetchTask(id);
  if (action === "ai") await generateAi(id);
  if (action === "sensitive") await showSensitiveLog(id);
  if (action === "siteLog") await showSiteSubmitLog(id);
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!target) return;
  if (target.id === "libraryItemSelect") renderLibraryManager(Number(target.value || 0));
  if (target.id === "sensitiveGroupSelect" || target.id === "sensitiveRuleSelect") renderSensitiveRuleEditor();
  if (target.id === "ruleItemSelect") renderRuleEditor(Number(target.value || 0));
  if (target.id === "taskDateFilter") {
    state.taskDate = target.value || todayDateKey();
    void loadTasks();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeTaskDetail();
  const loginStatus = event.target.closest?.("#webLoginStatus");
  if (loginStatus && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    void openWebLoginDialog();
  }
});

document.addEventListener("change", (event) => {
  const input = event.target.closest("input");
  if (!input) return;
  if (input.id === "selectAllTasks") {
    if (input.checked) {
      selectAllVisibleTasks();
    } else {
      clearSelectedTasks();
    }
  }
  if (input.classList.contains("task-check")) {
    const id = String(input.dataset.id || "");
    if (!id) return;
    if (input.checked) {
      state.selectedIds.add(id);
    } else {
      state.selectedIds.delete(id);
    }
    updateSelectedCount();
  }
});

window.addEventListener("DOMContentLoaded", async () => {
  const sitePanel = $("siteSubmit");
  const mount = $("webSubmitMount");
  if (sitePanel && mount) {
    sitePanel.classList.remove("panel", "hidden");
    sitePanel.removeAttribute("id");
    const details = document.createElement("details");
    details.className = "submit-settings-details";
    details.open = false;
    details.innerHTML = "<summary>提交文案与提交方式</summary>";
    while (sitePanel.firstChild) details.appendChild(sitePanel.firstChild);
    mount.appendChild(details);
    sitePanel.remove();
  }
  bindWorkFormPersistence();
  $("versionConfigBtn").onclick = openVersionConfigCard;
  $("versionConfigCloseBtn").onclick = closeVersionConfigCard;
  $("versionConfigCloseBtnBottom").onclick = closeVersionConfigCard;
  $("versionConfigCard").addEventListener("cancel", event => {
    event.preventDefault();
    closeVersionConfigCard();
  });
  $("versionConfigCard").addEventListener("click", event => {
    if (event.target === $("versionConfigCard")) closeVersionConfigCard();
  });
  $("processBtn").onclick = processInput;
  $("refreshBtn").onclick = refreshTasksAndSubmitHistory;
  $("taskRefreshBtn").onclick = refreshTasksAndSubmitHistory;
  $("taskTodayBtn").onclick = async () => { state.taskDate = todayDateKey(); await refreshTasksAndSubmitHistory(); };
  $("taskToggleBtn").onclick = () => { const details = $("taskListDetails"); details.open = !details.open; $("taskToggleBtn").textContent = details.open ? "收起任务" : "展开任务"; };
  $("selectAllBtn").onclick = selectAllVisibleTasks;
  $("clearSelectedBtn").onclick = clearSelectedTasks;
  $("retrySelectedBtn").onclick = () => batchRetry("selected");
  $("retryFailedBtn").onclick = () => batchRetry("failed");
  $("transferBatchFactoryBtn").onclick = transferSelectedToBatchFactory;
  $("applyRulesSelectedBtn").onclick = () => applyRules("selected");
  $("applyRulesAllBtn").onclick = () => applyRules("all");
  $("openWebSubmitBtn").onclick = openWebSubmitFromTasks;
  $("deleteSelectedBtn").onclick = () => batchDelete("selected");
  $("deleteFailedBtn").onclick = () => batchDelete("failed");
  $("deleteAllBtn").onclick = () => batchDelete("all");
  $("logsRefreshBtn").onclick = loadRecords;
  $("saveConfigBtn").onclick = saveConfig;
  $("saveKnowledgeConfigBtn").onclick = saveConfig;
  $("saveRulesConfigBtn").onclick = saveConfig;
  $("saveWorkflowBtn").onclick = saveConfig;
  $("saveAiConfigBtn").onclick = saveConfig;
  $("savePresetBtn").onclick = saveCurrentPreset;
  $("applyPresetBtn").onclick = applySelectedPreset;
  $("deletePresetBtn").onclick = deleteSelectedPreset;
  $("testAiBtn").onclick = testAi;
  $("libraryTypeSelect").onchange = () => renderLibraryManager(0);
  $("librarySearchInput").oninput = () => renderLibraryManager(Number($("libraryItemSelect").value || 0));
  $("addLibraryItemBtn").onclick = addLibraryItem;
  $("duplicateLibraryItemBtn").onclick = duplicateLibraryItem;
  $("saveLibraryItemBtn").onclick = () => saveLibraryItem(false);
  $("deleteLibraryItemBtn").onclick = deleteLibraryItem;
  $("optimizeLibraryItemBtn").onclick = optimizeLibraryItem;
  $("openingAnalyzeBtn").onclick = analyzeOpeningPhrase;
  $("openingSaveAnalyzedBtn").onclick = saveAnalyzedOpeningPhrase;
  $("openingClearAnalyzeBtn").onclick = clearOpeningAnalyzer;
  $("normalizeOpeningBtn").onclick = normalizeOpeningLibrary;
  $("ruleTypeSelect").onchange = () => renderRuleEditor(0);
  $("saveRuleEditorBtn").onclick = () => saveRuleEditor(false);
  $("previewRuleBtn").onclick = previewRuleResult;
  $("ruleAiSuggestBtn").onclick = suggestCurrentRuleWithAi;
  $("ruleAiApplyBtn").onclick = applyRuleSuggestions;
  $("syncWebProfilesBtn").onclick = () => syncWebSubmit("configs");
  $("syncWebStylesBtn").onclick = () => syncWebSubmit("styles");
  $("confirmWebSubmitSelectionBtn").onclick = confirmWebSubmitSelection;
  $("webAllowResubmit").onchange = updateResubmitHint;
  $("platformSelect").onchange = updatePlatformHint;
  await loadConfig();
  try {
    const environment = await api("/api/web-submit/environment");
    state.webLoginSession = environment.ok === true;
    renderWebLoginStatus(state.config?.web_submit || {});
  } catch (_) { state.webLoginSession = false; renderWebLoginStatus(state.config?.web_submit || {}); }
  await loadTasks();
  await restoreLatestProcessJob();
});
