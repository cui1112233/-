const RECOVERABLE_KINDS = ['high_imitation', 'opening_phrases', 'rewrite_templates'];

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasEntries(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasKnowledgeEntries(kind, value) {
  const knowledge = object(value);
  if (kind === 'high_imitation') return hasEntries(knowledge.prompts) || hasEntries(knowledge.references) || hasEntries(knowledge.items);
  if (kind === 'opening_phrases') return hasEntries(knowledge.items) || hasEntries(knowledge.styles);
  if (kind === 'rewrite_templates') return hasEntries(knowledge.profiles) || hasEntries(knowledge.temporary_instructions) || hasEntries(knowledge.items);
  return false;
}

function mergeKnowledgeSources(accountKnowledge, legacyKnowledge) {
  const account = object(accountKnowledge);
  const legacy = object(legacyKnowledge);
  const merged = { ...account };
  for (const kind of RECOVERABLE_KINDS) {
    if (!hasKnowledgeEntries(kind, legacy[kind])) continue;
    if (!hasKnowledgeEntries(kind, account[kind])) {
      merged[kind] = legacy[kind];
      continue;
    }
    const current = object(account[kind]);
    const fallback = object(legacy[kind]);
    const mergedKind = { ...fallback, ...current };
    const fields = kind === 'high_imitation'
      ? ['prompts', 'references', 'items']
      : kind === 'opening_phrases'
        ? ['items', 'styles']
        : ['profiles', 'temporary_instructions', 'items'];
    for (const field of fields) {
      if (!hasEntries(current[field]) && hasEntries(fallback[field])) mergedKind[field] = fallback[field];
    }
    merged[kind] = mergedKind;
  }
  return merged;
}

module.exports = { mergeKnowledgeSources };
