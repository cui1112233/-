import { normalizeScriptConstraints } from './scriptConstraints';
import { normalizeExtractInfo } from './scriptEntities';
import { normalizeExtractionPresetId } from './scriptExtractionPresets';

const storagePrefix = 'qiantie:script-draft:';
const draftVersion = 3;

function usernameKey(username) {
  return `${storagePrefix}${encodeURIComponent(String(username || 'guest'))}`;
}

function normalizeDraft(draft) {
  if (!draft?.values || typeof draft.values !== 'object') return null;
  if (![1, 2, draftVersion].includes(draft.version)) return null;
  return {
    ...draft,
    version: draftVersion,
    values: {
      ...draft.values,
      extractionPreset: normalizeExtractionPresetId(draft.values.extractionPreset)
    },
    extractInfo: normalizeExtractInfo(draft.extractInfo),
    constraints: normalizeScriptConstraints(draft.constraints)
  };
}

export function loadScriptDraft(storage, username) {
  try {
    const raw = storage?.getItem(usernameKey(username));
    if (!raw) return null;
    return normalizeDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveScriptDraft(storage, username, draft) {
  try {
    const normalized = normalizeDraft({ ...draft, version: draftVersion });
    if (!normalized) return false;
    storage?.setItem(usernameKey(username), JSON.stringify({
      ...normalized,
      savedAt: new Date().toISOString()
    }));
    return true;
  } catch {
    return false;
  }
}
