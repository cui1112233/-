import { apiRequest } from './client';

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

export function generateScript({ mode, format, duration, novelText, characters, scenes, visualStyle, protagonists, constraints, matchAudio, audioTotalSeconds }) {
  return apiRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      promptType: 'script',
      mode,
      format,
      duration,
      novelText,
      characters,
      scenes,
      visualStyle,
      protagonists,
      constraints,
      matchAudio: matchAudio === true,
      audioTotalSeconds: matchAudio === true ? audioTotalSeconds : null,
      max_tokens: format === 'shotlist' ? 16000 : 8192,
      temperature: 0.7,
      stream: false
    })
  });
}

export function generateQuickDirectorStoryboard({ novelText, duration, characters, scenes, visualStyle, descriptionMode, mustCoverDetails, shotRhythmRequirements }) {
  return apiRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      promptType: 'quick_director',
      novelText,
      duration,
      characters,
      scenes,
      visualStyle,
      descriptionMode,
      mustCoverDetails,
      shotRhythmRequirements,
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
