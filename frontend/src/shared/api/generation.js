import { apiRequest } from './client';

const SMART_UNIFIED_PREFIX_PRESET_ID = 'script-constraint-prefix-smart-unified';

function usesSmartUnifiedPrefix(constraints) {
  return constraints?.prefix?.enabled === true
    && constraints?.prefix?.source === 'system'
    && constraints?.prefix?.presetId === SMART_UNIFIED_PREFIX_PRESET_ID;
}

function smartUnifiedPrompt(result) {
  const prompt = String(result?.smartUnifiedStyle?.prompt || '').trim();
  if (!prompt) throw new Error('智能统一视觉分析未返回可用的统一风格。');
  return prompt;
}

export function generateSmartUnifiedStyle({ novelText, characters, scenes }) {
  return apiRequest('/api/script/smart-unified-style', {
    method: 'POST',
    body: JSON.stringify({ novelText, characters, scenes })
  });
}

async function resolveSmartUnifiedGenerationInput(input) {
  if (!usesSmartUnifiedPrefix(input?.constraints)) return input;
  const result = await generateSmartUnifiedStyle({
    novelText: input.novelText,
    characters: input.characters,
    scenes: input.scenes
  });
  const prompt = smartUnifiedPrompt(result);

  // constraintsForFormat() 返回的是本次生成专用对象。这里把权威风格写回该对象，
  // ScriptPage 后续 setOutputConstraints(requestConstraints) 与历史保存会直接持久化它。
  // 不修改用户“系统预设正文” body，避免下次打开设置时把动态结果误当成预设模板。
  if (input.constraints?.prefix && typeof input.constraints.prefix === 'object') {
    input.constraints.prefix.smartUnifiedStyle = prompt;
  }
  return { ...input, visualStyle: prompt };
}

export function extractCharactersAndScenes(novelText, extractionPreset = 'standard') {
  return apiRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      promptType: 'extract',
      novelText,
      extractionPreset,
      max_tokens: 4096,
      temperature: 0.3,
      stream: false
    })
  });
}

export function enrichScriptEntity({ entityType, novelText, entity, existingEntitySummary, extractionPreset }) {
  return apiRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      promptType: 'entity_enrich',
      entityType,
      novelText,
      entity,
      existingEntitySummary,
      extractionPreset,
      max_tokens: 1800,
      temperature: 0.2,
      stream: false
    })
  });
}

export async function generateScript({ mode, format, duration, novelText, characters, scenes, visualStyle, protagonists, constraints }) {
  const resolved = await resolveSmartUnifiedGenerationInput({
    mode, format, duration, novelText, characters, scenes, visualStyle, protagonists, constraints
  });
  return apiRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      promptType: 'script',
      mode: resolved.mode,
      format: resolved.format,
      duration: resolved.duration,
      novelText: resolved.novelText,
      characters: resolved.characters,
      scenes: resolved.scenes,
      visualStyle: resolved.visualStyle,
      protagonists: resolved.protagonists,
      constraints: resolved.constraints,
      max_tokens: resolved.format === 'shotlist' ? 16000 : 8192,
      temperature: 0.7,
      stream: false
    })
  });
}

export async function generateQuickDirectorStoryboard({ novelText, duration, characters, scenes, visualStyle, descriptionMode, mustCoverDetails, shotRhythmRequirements, matchAudio, audioTotalSeconds, constraints }) {
  const resolved = await resolveSmartUnifiedGenerationInput({
    novelText,
    duration,
    characters,
    scenes,
    visualStyle,
    descriptionMode,
    mustCoverDetails,
    shotRhythmRequirements,
    matchAudio,
    audioTotalSeconds,
    constraints
  });
  return apiRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      promptType: 'quick_director',
      novelText: resolved.novelText,
      duration: resolved.duration,
      characters: resolved.characters,
      scenes: resolved.scenes,
      visualStyle: resolved.visualStyle,
      descriptionMode: resolved.descriptionMode,
      mustCoverDetails: resolved.mustCoverDetails,
      shotRhythmRequirements: resolved.shotRhythmRequirements,
      matchAudio: resolved.matchAudio,
      audioTotalSeconds: resolved.audioTotalSeconds,
      constraints: resolved.constraints,
      max_tokens: 8192,
      temperature: 0.55,
      stream: false
    })
  });
}

export function listScriptPresetCatalog() {
  return apiRequest('/api/presets?module=script');
}

export function getConstraintPresetTexts(ids) {
  const values = Array.isArray(ids) ? ids.filter(Boolean) : [];
  return apiRequest(`/api/presets/constraint-text?ids=${encodeURIComponent(values.join(','))}`);
}

export function listScriptConstraintPrompts(category) { return apiRequest(`/api/script-constraint-prompts?category=${encodeURIComponent(category)}`); }
export function saveScriptConstraintPrompt(payload) { return apiRequest('/api/script-constraint-prompts', { method: 'POST', body: JSON.stringify(payload) }); }
export function updateScriptConstraintPrompt(id, payload) { return apiRequest(`/api/script-constraint-prompts/${id}`, { method: 'PUT', body: JSON.stringify(payload) }); }
export function deleteScriptConstraintPrompt(id) { return apiRequest(`/api/script-constraint-prompts/${id}`, { method: 'DELETE' }); }
export function markScriptConstraintPromptUsed(ids) { return apiRequest('/api/script-constraint-prompts/usage', { method: 'POST', body: JSON.stringify({ ids }) }); }
