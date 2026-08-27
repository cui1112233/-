const express = require('express');
const { apiAuth, checkRateLimit } = require('../middleware/auth');
const { readConfig, ensureReadyConfig, requestUpstream, requestUpstreamModels, collectResponse } = require('../lib/shared');
const { resolveSystemPresetBody } = require('../lib/system-preset-catalog');

const MODE_PRESET_ID_MAP = {
  continuous: 'script-continuous',
  hook: 'script-hook',
  segmented: 'script-segmented'
};

const FORMAT_PRESET_ID_MAP = {
  screenplay: 'script-format-screenplay',
  storyboard: 'script-format-storyboard',
  shortdrama: 'script-format-shortdrama',
  shotlist: 'script-format-shotlist',
  'q版': 'script-format-q版'
};

const FORMAT_NAME_MAP = {
  screenplay: '剧情模式',
  storyboard: '画布模式',
  shortdrama: '剧本模式',
  shotlist: '分镜模式',
  'q版': 'Q版模式'
};

const CONSTRAINT_CATEGORY_PREFIXES = {
  prefix: 'script-constraint-prefix-',
  quality: 'script-constraint-quality-',
  restriction: 'script-constraint-restriction-',
  negative: 'script-constraint-negative-'
};

function listPublishedExtractionPresets(presetStore) {
  return (presetStore?.listCatalog?.('script') || [])
    .filter(item => item.kind === 'base' && (item.protocolLock?.format === 'extract' || ['script-extract', 'script-extract-novel-panel'].includes(item.id)));
}

function resolveExtractionPresetId(value, presetStore) {
  const selected = typeof value === 'string' ? presetStore?.getPublished?.(value) : null;
  if (selected?.module === 'script' && selected.kind === 'base' && selected.protocolLock?.format === 'extract') return selected.id;
  const presets = listPublishedExtractionPresets(presetStore);
  if (!presets.length) return null;
  return presets[0].id;
}

function normalizeMode(value) {
  return Object.hasOwn(MODE_PRESET_ID_MAP, value) ? value : 'continuous';
}

function normalizeFormat(value) {
  return Object.hasOwn(FORMAT_PRESET_ID_MAP, value) ? value : 'screenplay';
}

function normalizeDuration(value) {
  return value === '15s' ? '15s' : '10s';
}

function buildExtractMessages(body, presetStore) {
  const extractionPresetId = resolveExtractionPresetId(body.extractionPreset, presetStore);
  if (!extractionPresetId) throw new Error('No published extraction preset available');
  const systemPrompt = resolveSystemPresetBody(presetStore, extractionPresetId);
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '请分析以下小说章节：\n\n' + String(body.novelText || '') }
  ];
}


const ENTITY_ENRICH_LIMITS = { novelText: 120000, fields: 12, fieldName: 80, fieldValue: 4000, summaryItems: 20, summaryItem: 800, listItems: 12, listItem: 1000 };

function entityText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function entityName(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return entityText(value['\u89d2\u8272\u540d\u79f0'] || value['\u573a\u666f\u540d\u79f0'] || value['\u540d\u79f0'] || value.name, 160);
}

function sanitizeEntityFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value).slice(0, ENTITY_ENRICH_LIMITS.fields).reduce((result, [key, item]) => {
    const field = entityText(key, ENTITY_ENRICH_LIMITS.fieldName);
    const content = entityText(item, ENTITY_ENRICH_LIMITS.fieldValue);
    if (field && content) result[field] = content;
    return result;
  }, {});
}

function sanitizeEntitySummary(value) {
  const source = value && typeof value === 'object' ? value : {};
  const sanitizeList = items => (Array.isArray(items) ? items : []).slice(0, ENTITY_ENRICH_LIMITS.summaryItems)
    .map(item => sanitizeEntityFields(item))
    .map(item => Object.fromEntries(Object.entries(item).map(([key, content]) => [key, content.slice(0, ENTITY_ENRICH_LIMITS.summaryItem)])));
  return { characters: sanitizeList(source.characters), scenes: sanitizeList(source.scenes) };
}

function validateEntityEnrichmentBody(body, presetStore) {
  if (!body || typeof body !== 'object') throw new Error('Invalid entity enrichment request');
  if (!['character', 'scene'].includes(body.entityType)) throw new Error('Invalid entity type');
  const novelText = entityText(body.novelText, ENTITY_ENRICH_LIMITS.novelText);
  if (!novelText) throw new Error('Novel text is required');
  const entity = sanitizeEntityFields(body.entity);
  if (!entityName(entity)) throw new Error('Entity name is required');
  const extractionPreset = resolveExtractionPresetId(body.extractionPreset, presetStore);
  if (!extractionPreset) throw new Error('No published extraction preset available');
  return { entityType: body.entityType, novelText, entity, existingEntitySummary: sanitizeEntitySummary(body.existingEntitySummary), extractionPreset };
}

function normalizeEntityEnrichment(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const list = value => (Array.isArray(value) ? value : []).map(item => entityText(item, ENTITY_ENRICH_LIMITS.listItem)).filter(Boolean).slice(0, ENTITY_ENRICH_LIMITS.listItems);
  return { fields: sanitizeEntityFields(source.fields), evidence: list(source.evidence), suggestions: list(source.suggestions), uncertainties: list(source.uncertainties) };
}

function parseEntityEnrichment(value) {
  const raw = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return normalizeEntityEnrichment(parsed);
  } catch {
    throw new Error('Entity enrichment response must be valid JSON');
  }
}

function buildEntityEnrichmentMessages(body, presetStore) {
  const input = validateEntityEnrichmentBody(body, presetStore);
  const base = resolveSystemPresetBody(presetStore, input.extractionPreset);
  const protocol = '\u5c0f\u8bf4\u539f\u6587\u4e3a\u4e3b\u8981\u4f9d\u636e\uff1b\u73b0\u6709\u5361\u6458\u8981\u4ec5\u7528\u4e8e\u907f\u514d\u91cd\u590d\u6216\u51b2\u7a81\u3002\u4e0d\u5f97\u8986\u76d6\u7528\u6237\u5df2\u586b\u5199\u7684\u975e\u7a7a\u5b57\u6bb5\uff1b\u5bf9\u51b2\u7a81\u5224\u65ad\u5199\u5165 suggestions\u3002\u6ca1\u6709\u539f\u6587\u4f9d\u636e\u7684\u5185\u5bb9\u5fc5\u987b\u5199\u5165 uncertainties\uff0c\u4e0d\u5f97\u4f5c\u4e3a\u4e8b\u5b9e\u5199\u5165 fields\u3002\u53ea\u8fd4\u56de JSON\uff1afields\u3001evidence\u3001suggestions\u3001uncertainties\u3002';
  return [
    { role: 'system', content: [base, protocol].filter(Boolean).join('\n\n---\n\n') },
    { role: 'user', content: `\u5b9e\u4f53\u7c7b\u578b\uff1a${input.entityType}\n\n\u5c0f\u8bf4\u539f\u6587\uff1a\n${input.novelText}\n\n\u5f53\u524d\u5b9e\u4f53\uff08\u4eba\u5de5\u5b57\u6bb5\uff09\uff1a\n${JSON.stringify(input.entity)}\n\n\u5df2\u6709\u5b9e\u4f53\u6458\u8981\uff1a\n${JSON.stringify(input.existingEntitySummary)}` }
  ];
}

function serializePromptSection(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function constraintPreset(presetStore, id) {
  if (!id || typeof id !== 'string') return null;
  if (presetStore?.getPublished) return presetStore.getPublished(id);
  return null;
}

function resolveConstraintText(presetStore, category, value, personalPromptStore, username) {
  if (value?.enabled !== true) return '';
  if (value.source === 'personal') {
    const prompt = personalPromptStore?.getOwned?.(username, value.personalPromptId);
    return prompt?.category === category ? String(prompt.body || '').trim() : '';
  }
  if (value.source === 'draft') return String(value.body || '').trim();
  const presetId = String(value?.presetId || '');
  const prefix = CONSTRAINT_CATEGORY_PREFIXES[category];
  if (!prefix || !presetId.startsWith(prefix)) return '';
  const preset = constraintPreset(presetStore, presetId);
  if (!preset || preset.kind !== 'addon' || preset.protocolLock?.format !== 'constraint' || preset.protocolLock?.category !== category) return '';
  return String(preset.body || '').trim();
}

function buildConstraintWrapper(presetStore, constraints, format, duration, personalPromptStore, username, visualStyle) {
  const prefix = resolveConstraintText(presetStore, 'prefix', constraints?.prefix, personalPromptStore, username);
  // 统一风格来自本次小说的人物/场景提取。仅在用户开启画面前缀时写入，
  // 以免未开启约束设置的剧本输出被静态视频提示词污染。
  const extractedStyle = constraints?.prefix?.enabled === true ? String(visualStyle || '').trim() : '';
  const quality = resolveConstraintText(presetStore, 'quality', constraints?.quality, personalPromptStore, username);
  const restriction = resolveConstraintText(presetStore, 'restriction', constraints?.restriction, personalPromptStore, username);
  const negative = resolveConstraintText(presetStore, 'negative', constraints?.negative, personalPromptStore, username);
  const constraintText = [
    (extractedStyle || prefix) && `【画面前缀】\n${[extractedStyle, prefix].filter(Boolean).join('\n')}`,
    (quality || restriction) && `【画质约束】\n${[quality, restriction].filter(Boolean).join('\n')}`,
    negative && `负面提示词：\n${negative}`
  ].filter(Boolean).join('\n\n');
  if (!constraintText) return '';

  const protocol = resolveSystemPresetBody(presetStore, 'script-constraint-wrapper')
    .replace(/\{duration\}/g, duration || '10s');
  return `${protocol}\n\n## 分镜内约束\n${constraintText}\n\n每个完整分镜必须在自身标题之后写入以上所有非空约束；不得在全部分镜之外单独输出这些约束。`;
}

function sanitizeProtagonists(characters, protagonists) {
  const known = new Set((Array.isArray(characters) ? characters : []).map(item => JSON.stringify(item)));
  return (Array.isArray(protagonists) ? protagonists : []).filter(item => known.has(JSON.stringify(item)));
}

function buildScriptMessages(body, presetStore, personalPromptStore, username) {
  const mode = normalizeMode(body.mode);
  const format = normalizeFormat(body.format);
  const formatName = FORMAT_NAME_MAP[format];
  const duration = normalizeDuration(body.duration);
  const secs = duration === '15s' ? '15' : '10';
  const endTime = duration === '15s' ? '00:15' : '00:10';
  const hasBaseSetup = body.constraints?.baseSetup?.enabled === true;

  let formatContent = resolveSystemPresetBody(presetStore, FORMAT_PRESET_ID_MAP[format]);
  formatContent = formatContent.replace(/\{10s或15s\}/g, duration);
  formatContent = formatContent.replace(/\{X\}/g, secs);
  formatContent = formatContent.replace(/\{2X\}/g, String(parseInt(secs, 10) * 2));
  formatContent = formatContent.replace(/\{duration\}/g, duration);
  formatContent = formatContent.replace(/\{结束时间\}/g, endTime);

  let directorMaster = format === 'shotlist'
    ? resolveSystemPresetBody(presetStore, 'script-director-storyboard-master')
    : '';
  directorMaster = directorMaster.replace(/\{10s或15s\}/g, duration);
  directorMaster = directorMaster.replace(/\{duration\}/g, duration);

  let modeContent = resolveSystemPresetBody(presetStore, MODE_PRESET_ID_MAP[mode]);
  modeContent = modeContent.replace(/\{10s或15s\}/g, duration);
  modeContent = modeContent.replace(/\{X\}/g, secs);
  modeContent = modeContent.replace(/\{2X\}/g, String(parseInt(secs, 10) * 2));
  modeContent = modeContent.replace(/\{duration\}/g, duration);
  modeContent = modeContent.replace(/\{结束时间\}/g, endTime);

  const constraintWrapper = buildConstraintWrapper(presetStore, body.constraints, format, duration, personalPromptStore, username, body.visualStyle);
  const sourceText = String(body.novelText || '').trim();
  const compactSourceGuard = sourceText.length <= 600
    ? `## 短原文时长硬校验\n原文仅 ${sourceText.length} 字，且没有明确的地点/时间/叙事层切换时，只输出 1 个分镜单元；不得为了填满内容新增事件、人物、对白或空镜。`
    : '';
  const durationGuard = `## 时长硬校验（最高优先级）\n每个分镜单元的总时长只能是 ${duration}；时间轴必须从 00:00 连续到 ${endTime}，任何结束时间不得超过 ${endTime}。禁止输出 60s、100s、01:00 或跨单元累计时间；内容不足时保持动作简洁，不得用重复动作填时长。`;
  // 分段开头使用用户已发布的“分镜模式/分段开头”预设自行定义输出结构（如“镜头一/镜头二”独立段），
  // 不再注入额外的完整分镜协议，避免与已发布预设冲突、让模型困惑。
  const unitProtocol = format === 'shortdrama' || format === 'q版' || mode === 'segmented'
    ? ''
    : `## 强制完整分镜协议\n只输出一个或多个独立完整分镜。每个单元从 ### 分镜一（总时长：${duration}）开始，后续为 ### 分镜二。禁止顶层镜头标题或共享前言。每个分镜从 00:00 开始并于 ${endTime} 结束；每个分镜自身必须写入当前格式需要的${hasBaseSetup ? '人物、场景、基础设定及' : ''}所有已启用约束，确保可独立复制提交。`;
  const protagonists = hasBaseSetup ? sanitizeProtagonists(body.characters, body.protagonists) : [];
  const protagonistPrompt = protagonists.length
    ? '## 主角白名单（优先级最高）\n' + serializePromptSection(protagonists) + '\n\n必须优先围绕这些主角组织剧情、镜头和人物一致性；不得改名、合并、替换或弱化其身份、外形与关键关系。'
    : '';
  const systemPrompt = [
    modeContent,
    resolveSystemPresetBody(presetStore, 'script-general').replace(/\{duration\}/g, duration),
    directorMaster,
    unitProtocol,
    durationGuard,
    compactSourceGuard,
    constraintWrapper,
    !hasBaseSetup && '基础设定未启用：不得输出【基础设定】、【人物与场景】、人物卡、场景卡、统一人物或场景环境等独立设定区块；只在剧情时间轴中写原文必要的人名、动作和地点。',
    formatContent
  ].filter(Boolean).join('\n\n---\n\n');

  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: '## 小说原文\n' + String(body.novelText || '') +
        (hasBaseSetup ? '\n\n## 人物信息\n' + serializePromptSection(body.characters) +
        '\n\n## 场景信息\n' + serializePromptSection(body.scenes) : '') +
        (protagonistPrompt ? '\n\n' + protagonistPrompt : '') +
        '\n\n请将以上小说章节转化为' + formatName + '。'
    }
  ];
}

function buildQuickDirectorMessages(body, presetStore) {
  const novelText = String(body?.novelText || '').trim();
  if (!novelText) throw new Error('Novel text is required');
  const duration = normalizeDuration(body?.duration);
  const descriptionModeIds = {
    strict: 'script-quick-director-mode-strict', concise: 'script-quick-director-mode-concise',
    balanced: 'script-quick-director-mode-balanced', detailed: 'script-quick-director-mode-detailed',
    example: 'script-quick-director-mode-example', reference: 'script-quick-director-mode-reference'
  };
  const descriptionMode = Object.hasOwn(descriptionModeIds, body?.descriptionMode) ? body.descriptionMode : 'strict';
  const quickDirectorBase = resolveSystemPresetBody(presetStore, 'script-quick-director-storyboard')
    .replace(/\{duration\}/g, duration)
    .replace(/\{descriptionModeRules\}/g, resolveSystemPresetBody(presetStore, descriptionModeIds[descriptionMode]));
  // 小说获取的自动入口与“分段开头 + 分镜模式”共用同一份导演母版；
  // 它只省去人工逐步点击，并不降级场景、事件、连续性与质量规则。
  const directorMaster = resolveSystemPresetBody(presetStore, 'script-director-storyboard-master')
    .replace(/\{duration\}/g, duration);
  const endTime = duration === '15s' ? '00:15' : '00:10';
  const compactSourceGuard = novelText.length <= 600
    ? `## 短原文时长硬校验\n原文仅 ${novelText.length} 字，且没有明确的地点/时间/叙事层切换时，只输出 1 个分镜单元；不得新增事件、人物、对白或重复动作。`
    : '';
  const durationGuard = `## 时长硬校验（最高优先级）\n每个分镜单元总时长只能是 ${duration}，从 00:00 连续到 ${endTime}；禁止输出 60s、100s、01:00 或跨单元累计时间。内容不足时保持动作简洁，不得用重复动作填时长。`;
  const systemPrompt = [quickDirectorBase, directorMaster, durationGuard, compactSourceGuard].filter(Boolean).join('\n\n---\n\n');
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: [
      `## 小说原文\n${novelText}`,
      `## 分析后的统一风格\n${String(body?.visualStyle || '').trim() || '请根据全文自行判断'}`,
      `## 人物卡\n${serializePromptSection(body?.characters)}`,
      `## 场景卡\n${serializePromptSection(body?.scenes)}`,
      `## 必须拍出的原文细节\n${String(body?.mustCoverDetails || '').trim() || '未填写；按原文完整还原'}`,
      `## 镜头节奏与推进要求\n${String(body?.shotRhythmRequirements || '').trim() || '未填写；按剧情自动决定'}`,
      '请直接交付完整导演分镜成品。'
    ].join('\n\n') }
  ];
}

function buildMessages(body, presetStore, personalPromptStore, username) {
  if (body.promptType === 'extract') return buildExtractMessages(body, presetStore);
  if (body.promptType === 'script') return buildScriptMessages(body, presetStore, personalPromptStore, username);
  if (body.promptType === 'quick_director') return buildQuickDirectorMessages(body, presetStore);
  return Array.isArray(body.messages) ? body.messages : [];
}

function describeUpstreamFailure(upstream) {
  let details = '';
  try {
    const parsed = JSON.parse(upstream.text);
    details = parsed?.error?.message || parsed?.message || '';
  } catch (error) {
    details = String(upstream.text || '').trim().slice(0, 300);
  }
  return ['Upstream API error (status ' + upstream.statusCode + ')', details].filter(Boolean).join(': ');
}

function createChatRouter({
  configReader = readConfig,
  connectionConfigReader = readConfig,
  upstreamRequest = requestUpstream,
  modelsRequest = requestUpstreamModels,
  responseCollector = collectResponse
} = {}) {
  const router = express.Router();
  router.use(apiAuth);

  function useProvidedValue(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  function isReadyConnectionConfig(config) {
    try {
      ensureReadyConfig(config);
      return true;
    } catch {
      return false;
    }
  }

  function sendInvalidConnectionConfig(res, kind) {
    return res.status(400).json({
      ok: false,
      kind,
      error: kind === 'image'
        ? '请填写完整的生图服务地址、模型和 API Key。'
        : '请填写完整的文本服务地址、模型和 API Key。'
    });
  }

  function sendUpstreamConnectionFailure(res, kind, upstream) {
    const status = Number(upstream?.statusCode) || 502;
    return res.status(502).json({
      ok: false,
      kind,
      error: `上游模型服务请求失败（状态 ${status}）。`,
      type: 'upstream_error'
    });
  }

  function sendConnectionRequestFailure(res, kind) {
    return res.status(502).json({
      ok: false,
      kind,
      error: '模型服务连接失败，请检查服务地址、网络和代理设置。',
      type: 'upstream_connection_error'
    });
  }

  function readConnectionConfig(res, kind, username) {
    try {
      return connectionConfigReader(username);
    } catch {
      res.status(500).json({ ok: false, kind, error: '无法读取当前模型配置，请稍后重试。' });
      return null;
    }
  }

  async function testTextConnection(req, res) {
    const current = readConnectionConfig(res, 'text', req.username);
    if (!current) return;
    const body = req.body || {};
    const config = {
      provider: useProvidedValue(body.provider, current.provider),
      baseUrl: useProvidedValue(body.baseUrl, current.baseUrl),
      model: useProvidedValue(body.model, current.model),
      apiKey: useProvidedValue(body.apiKey, current.apiKey)
    };
    if (!isReadyConnectionConfig(config)) return sendInvalidConnectionConfig(res, 'text');

    try {
      const upstream = await upstreamRequest(config, {
        model: config.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5
      }, responseCollector);
      if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
        return sendUpstreamConnectionFailure(res, 'text', upstream);
      }
      let data;
      try {
        data = JSON.parse(upstream.text);
      } catch {
        return res.status(502).json({ ok: false, kind: 'text', error: '上游文本模型未返回有效 JSON。' });
      }
      const message = data?.choices?.[0]?.message;
      if (!message) {
        return res.status(502).json({ ok: false, kind: 'text', error: '上游文本模型未返回有效答复。' });
      }
      return res.json({ ok: true, kind: 'text', message });
    } catch {
      return sendConnectionRequestFailure(res, 'text');
    }
  }

  async function testImageConnection(req, res) {
    const current = readConnectionConfig(res, 'image', req.username);
    if (!current) return;
    const body = req.body || {};
    const savedImage = current?.image && typeof current.image === 'object' ? current.image : {};
    const image = body.image && typeof body.image === 'object' && !Array.isArray(body.image) ? body.image : {};
    const config = {
      provider: useProvidedValue(image.provider, savedImage.provider),
      baseUrl: useProvidedValue(image.baseUrl, savedImage.baseUrl),
      model: useProvidedValue(image.model, savedImage.model),
      apiKey: useProvidedValue(image.apiKey, savedImage.apiKey)
    };
    if (!isReadyConnectionConfig(config)) return sendInvalidConnectionConfig(res, 'image');

    try {
      const upstream = await modelsRequest(config, responseCollector);
      if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
        return sendUpstreamConnectionFailure(res, 'image', upstream);
      }
      let data;
      try {
        data = JSON.parse(upstream.text);
      } catch {
        return res.status(502).json({ ok: false, kind: 'image', error: '上游生图模型未返回有效 JSON。' });
      }
      if (!Array.isArray(data?.data)) {
        return res.status(502).json({ ok: false, kind: 'image', error: '上游生图模型目录格式无效。' });
      }
      const modelListed = data.data.some(item => item && typeof item.id === 'string' && item.id === config.model);
      return res.json({
        ok: true,
        kind: 'image',
        modelListed,
        message: modelListed
          ? '生图模型连接成功，当前模型已在模型目录中找到。'
          : '生图服务连接成功，但当前模型未出现在模型目录中，请确认模型名称或供应商支持。'
      });
    } catch {
      return sendConnectionRequestFailure(res, 'image');
    }
  }

  router.post(['/test', '/test/text'], testTextConnection);
  router.post('/test/image', testImageConnection);

  router.post('/chat', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: 'Too many requests. Please slow down.' });
    return;
  }

  try {
    const config = configReader(req.username);
    ensureReadyConfig(config);

    const body = req.body;
    const maxTokens = Math.min(Math.max(1, parseInt(body.max_tokens) || 4096), 32768);
    const rawTemp = Number(body.temperature);
    const temperature = Number.isFinite(rawTemp) ? Math.min(Math.max(0, rawTemp), 2.0) : 0.7;
    const payload = {
      messages: buildMessages(body, req.app.locals.presetStore, req.app.locals.scriptConstraintPromptStore, req.username),
      max_tokens: maxTokens,
      temperature,
      model: config.model,
      stream: body.stream === true
    };

    const selectedPersonalPromptIds = body.promptType === 'script'
      ? [...new Set(['prefix', 'quality', 'restriction', 'negative']
        .map(category => body.constraints?.[category])
        .filter(value => value?.enabled === true && value.source === 'personal' && typeof value.personalPromptId === 'string')
        .map(value => value.personalPromptId))]
      : [];

    if (payload.stream === true) {
      await upstreamRequest(config, payload, upstreamRes => new Promise((resolve, reject) => {
        if ((upstreamRes.statusCode || 500) < 400 && selectedPersonalPromptIds.length) req.app.locals.scriptConstraintPromptStore?.markUsed(req.username, selectedPersonalPromptIds);
        res.writeHead(upstreamRes.statusCode || 500, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        });
        upstreamRes.on('data', chunk => res.write(chunk));
        upstreamRes.on('end', () => {
          res.end();
          resolve();
        });
        upstreamRes.on('error', error => {
          res.end();
          reject(error);
        });
      }));
      return;
    }

    payload.stream = false;
    const upstream = await upstreamRequest(config, payload, responseCollector);
    if (upstream.statusCode >= 400) {
      res.status(502).json({ error: describeUpstreamFailure(upstream), type: 'upstream_error' });
      return;
    }
    try {
      JSON.parse(upstream.text);
    } catch (error) {
      res.status(502).json({ error: 'Upstream returned non-JSON response' });
      return;
    }

    if (body.promptType === 'entity_enrich') {
      const content = JSON.parse(upstream.text)?.choices?.[0]?.message?.content;
      return res.json({ enrichment: parseEntityEnrichment(content) });
    }
    if (selectedPersonalPromptIds.length) req.app.locals.scriptConstraintPromptStore?.markUsed(req.username, selectedPersonalPromptIds);
    res.writeHead(upstream.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(upstream.text);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
  });

  router._private = {
  buildEntityEnrichmentMessages,
  buildExtractMessages,
  buildScriptMessages,
  buildQuickDirectorMessages,
  buildMessages,
  buildConstraintWrapper,
  normalizeDuration,
  listPublishedExtractionPresets,
  resolveExtractionPresetId,
  normalizeFormat,
  normalizeMode,
  resolveConstraintText,
  serializePromptSection,
  sanitizeProtagonists,
  describeUpstreamFailure,
  parseEntityEnrichment,
    validateEntityEnrichmentBody,
    testImageConnection,
    testTextConnection
  };

  return router;
}

const router = createChatRouter();
router.createChatRouter = createChatRouter;
module.exports = router;
