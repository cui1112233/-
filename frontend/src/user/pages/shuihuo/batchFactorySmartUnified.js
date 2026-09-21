const SMART_UNIFIED_PREFIX_PRESET_ID = 'script-constraint-prefix-smart-unified';

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function effectivePromptConfig(batch, book) {
  const batchConfig = object(object(batch?.settingsState?.patch).aiPromptConfig);
  const bookConfig = object(object(book?.settingsState?.patch).aiPromptConfig);
  const batchConstraints = object(batchConfig.constraints);
  const bookConstraints = object(bookConfig.constraints);
  return {
    ...batchConfig,
    ...bookConfig,
    constraints: {
      ...batchConstraints,
      ...bookConstraints,
      selections: Array.isArray(bookConstraints.selections) ? bookConstraints.selections : batchConstraints.selections
    }
  };
}

export function smartUnifiedDisplayEnabled(batch, book) {
  const selections = effectivePromptConfig(batch, book).constraints?.selections;
  return Array.isArray(selections) && selections.some(selection => (
    selection?.presetId === SMART_UNIFIED_PREFIX_PRESET_ID && selection?.constraintCategory === 'prefix'
  ));
}

export function smartUnifiedAnalysisForBook(book) {
  const output = object(book?.directorRevision?.output);
  const analysis = object(output.smart_unified_analysis || output.smartUnifiedAnalysis);
  if (String(analysis.prompt || '').trim()) return analysis;
  const legacyPrompt = String(output.smart_unified_style || output.smartUnifiedStyle || '').trim();
  return legacyPrompt ? { prompt: legacyPrompt, fields: {}, preset: {} } : null;
}
