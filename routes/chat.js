const express = require('express');
const { apiAuth, checkRateLimit } = require('../middleware/auth');
const {
  readConfig,
  ensureReadyConfig,
  requestUpstream,
  collectResponse
} = require('../lib/shared');
const { resolveSystemPresetBody } = require('../lib/system-preset-catalog');

function resolveChatConfig(req) {
  const account = req.auth?.account;
  if (account?.role === 'member') {
    if (account.apiGranted !== true || !account.boundTo) {
      const error = new Error('API access has not been granted');
      error.code = 'API_ACCESS_FORBIDDEN';
      throw error;
    }
    return readConfig(account.boundTo);
  }
  return readConfig(req.username);
}

const router = express.Router();
router.use(apiAuth);

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
  'q版': 'script-format-qban'
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

function buildConstraintWrapper(presetStore, constraints, format, duration, personalPromptStore, username) {
  if (format === 'shortdrama' || constraints?.enabled !== true) return '';
  const prefix = resolveConstraintText(presetStore, 'prefix', constraints?.prefix, personalPromptStore, username);
  const quality = resolveConstraintText(presetStore, 'quality', constraints?.quality, personalPromptStore, username);
  const restriction = resolveConstraintText(presetStore, 'restriction', constraints?.restriction, personalPromptStore, username);
  const negative = resolveConstraintText(presetStore, 'negative', constraints?.negative, personalPromptStore, username);
  const constraintText = [
    prefix && `【画面前缀】\n${prefix}`,
    (quality || restriction) && `【画质约束】\n${[quality, restriction].filter(Boolean).join('\n')}`,
    negative && `负面提示词：\n${negative}`
  ].filter(Boolean).join('\n\n');
  if (!constraintText) return '';

  const protocol = resolveSystemPresetBody(presetStore, 'script-constraint-wrapper')
    .replace(/\{duration\}/g, duration || '10s');
  return `${protocol}\n\n## 分镜内约束\n${constraintText}\n\n生成画面内容时必须遵守以上约束，但不得把约束文本写入输出结果；最终由系统在把总时间轴切分为独立分镜卡时，把约束复制到每一张卡。`;
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

  let formatContent = resolveSystemPresetBody(presetStore, FORMAT_PRESET_ID_MAP[format]);
  formatContent = formatContent.replace(/\{10s或15s\}/g, duration);
  formatContent = formatContent.replace(/\{X\}/g, secs);
  formatContent = formatContent.replace(/\{2X\}/g, String(parseInt(secs, 10) * 2));
  formatContent = formatContent.replace(/\{duration\}/g, duration);
  formatContent = formatContent.replace(/\{结束时间\}/g, endTime);

  let modeContent = resolveSystemPresetBody(presetStore, MODE_PRESET_ID_MAP[mode]);
  modeContent = modeContent.replace(/\{10s或15s\}/g, duration);
  modeContent = modeContent.replace(/\{X\}/g, secs);
  modeContent = modeContent.replace(/\{2X\}/g, String(parseInt(secs, 10) * 2));
  modeContent = modeContent.replace(/\{duration\}/g, duration);
  modeContent = modeContent.replace(/\{结束时间\}/g, endTime);

  const constraintWrapper = buildConstraintWrapper(presetStore, body.constraints, format, duration, personalPromptStore, username);
  // 分段开头使用用户已发布的“分镜模式/分段开头”预设自行定义输出结构（如“镜头一/镜头二”独立段），
  // 不再注入额外的完整分镜协议，避免与已发布预设冲突、让模型困惑。
  const unitProtocol = format === 'shortdrama' || format === 'q版' || mode === 'segmented'
    ? ''
    : `## 强制完整分镜协议\n输出一条连续的总时间轴，把整段原文按内容量转成可拍摄的画面描述。时间轴从 00:00 连续排布，每个时间片 1 到 4 秒、只承担一个观看重点，总时长按原文信息量分配（每约 38 个汉字对应 1 个时间片），信息不足时宁可减少时间片，禁止复制镜头或机械口型补时长。禁止输出 ### 分镜N 标题，禁止把时间轴拆成多个独立分镜单元；最终由系统按 ${duration} 自动切分为独立分镜卡，每张卡会补上基础设定与已启用约束并从 00:00 开始，可直接复制提交。`;
  // 非分段模式按字数给时间片预算，防止总时长膨胀（对齐小说面板“38字≈1时间片”）。
  const budgetSourceLength = String(body.novelText || '').replace(/\s+/g, '').length;
  const budgetCenter = Math.max(3, Math.min(36, Math.ceil(budgetSourceLength / 38)));
  const budgetRule = format === 'shortdrama' || mode === 'segmented'
    ? ''
    : `【本次生成预算】总时长按原文信息量分配：每约 38 个汉字对应 1 个时间片，建议共 ${budgetCenter} 个时间片（可±3），每个时间片 1 到 4 秒；禁止复制镜头、静止口型或无变化定镜补时长。`;
  const protagonists = sanitizeProtagonists(body.characters, body.protagonists);
  const protagonistPrompt = protagonists.length
    ? '## 主角白名单（优先级最高）\n' + serializePromptSection(protagonists) + '\n\n必须优先围绕这些主角组织剧情、镜头和人物一致性；不得改名、合并、替换或弱化其身份、外形与关键关系。'
    : '';
  const systemPrompt = [
    modeContent,
    resolveSystemPresetBody(presetStore, 'script-general'),
    unitProtocol,
    budgetRule,
    constraintWrapper,
    formatContent
  ].filter(Boolean).join('\n\n---\n\n');

  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: '## 小说原文\n' + String(body.novelText || '') +
        '\n\n## 人物信息\n' + serializePromptSection(body.characters) +
        '\n\n## 场景信息\n' + serializePromptSection(body.scenes) +
        (protagonistPrompt ? '\n\n' + protagonistPrompt : '') +
        '\n\n请将以上小说章节转化为' + formatName + '。'
    }
  ];
}

function buildMessages(body, presetStore, personalPromptStore, username) {
  if (body.promptType === 'extract') return buildExtractMessages(body, presetStore);
  if (body.promptType === 'script') return buildScriptMessages(body, presetStore, personalPromptStore, username);
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

router.post('/test', async (req, res) => {
  try {
    const current = resolveChatConfig(req);
    const body = req.body || {};
    const config = {
      ...current,
      provider: body.provider || current.provider,
      baseUrl: body.baseUrl || current.baseUrl,
      model: body.model || current.model,
      apiKey: body.apiKey || current.apiKey
    };
    ensureReadyConfig(config);

    const payload = {
      model: config.model,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 5
    };

    const upstream = await requestUpstream(config, payload, collectResponse);
    let data;

    try {
      data = JSON.parse(upstream.text);
    } catch (error) {
      res.status(502).json({ ok: false, error: 'Upstream did not return JSON', status: upstream.statusCode });
      return;
    }

    if (upstream.statusCode >= 200 && upstream.statusCode < 300 && data && data.choices && data.choices[0] && data.choices[0].message) {
      res.json({ ok: true, message: data.choices[0].message });
      return;
    }

    res.status(502).json({ ok: false, error: 'Upstream response missing choices[0].message', status: upstream.statusCode, details: data });
  } catch (error) {
    if (error.code === 'API_ACCESS_FORBIDDEN') {
      res.status(403).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.post('/chat', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: 'Too many requests. Please slow down.' });
    return;
  }

  try {
    const config = resolveChatConfig(req);
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
      await requestUpstream(config, payload, upstreamRes => new Promise((resolve, reject) => {
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
    const upstream = await requestUpstream(config, payload, collectResponse);
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
    if (error.code === 'API_ACCESS_FORBIDDEN') {
      res.status(403).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router._private = {
  buildEntityEnrichmentMessages,
  buildExtractMessages,
  buildScriptMessages,
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
  validateEntityEnrichmentBody
};

module.exports = router;
