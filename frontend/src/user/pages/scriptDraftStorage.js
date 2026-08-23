import { normalizeScriptConstraints } from './scriptConstraints.js';
import { normalizeExtractInfo } from './scriptEntities.js';
import { normalizeExtractionPresetId } from './scriptExtractionPresets.js';

const storagePrefix = 'qiantie:script-draft:';
const tabStorageKey = 'qiantie:script-draft-tab-id';
const draftVersion = 4;

function usernameKey(username) {
  return `${storagePrefix}${encodeURIComponent(String(username || 'guest'))}`;
}

function tabDraftKey(username, tabId) {
  return `${usernameKey(username)}:${encodeURIComponent(String(tabId || ''))}`;
}

function createFallbackTabId() {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getScriptDraftTabId(sessionStorageLike, random = () => crypto.randomUUID()) {
  try {
    const existing = sessionStorageLike?.getItem(tabStorageKey);
    if (typeof existing === 'string' && existing) return existing;
  } catch {}

  let tabId;
  try {
    tabId = String(random() || '');
  } catch {
    tabId = '';
  }
  tabId = tabId || createFallbackTabId();

  try {
    sessionStorageLike?.setItem(tabStorageKey, tabId);
  } catch {}
  return tabId;
}

function normalizeDraft(draft) {
  if (!draft?.values || typeof draft.values !== 'object') return null;
  if (![1, 2, 3, draftVersion].includes(draft.version)) return null;
  const constraints = normalizeScriptConstraints(draft.constraints);
  // v3 drafts predate the base-setup switch; preserve their stored shape and
  // let the current page defaults add the new layer when it is needed.
  if (draft.version <= 3 && !Object.hasOwn(draft.constraints || {}, 'baseSetup')) {
    delete constraints.baseSetup;
  }
  const shotVideoTasks = {};
  if (draft.shotVideoTasks && typeof draft.shotVideoTasks === 'object' && !Array.isArray(draft.shotVideoTasks)) {
    for (const [index, task] of Object.entries(draft.shotVideoTasks)) {
      const taskId = typeof task?.taskId === 'string' ? task.taskId.trim() : '';
      const status = ['processing', 'succeeded', 'failed'].includes(task?.status) ? task.status : '';
      if (!/^\d+$/.test(index) || !taskId || !status) continue;
      const entry = { taskId, status };
      if (typeof task.error === 'string' && task.error.trim()) entry.error = task.error.trim();
      if (typeof task.videoUrl === 'string' && /^https:\/\//i.test(task.videoUrl)) entry.videoUrl = task.videoUrl;
      shotVideoTasks[index] = entry;
    }
  }
  return {
    ...draft,
    version: draftVersion,
    values: {
      ...draft.values,
      extractionPreset: normalizeExtractionPresetId(draft.values.extractionPreset)
    },
    extractInfo: normalizeExtractInfo(draft.extractInfo),
    constraints,
    shotVideoTasks
  };
}

export function loadScriptDraft(storage, username, tabId) {
  if (!tabId) return null;

  let tabRaw;
  try {
    tabRaw = storage?.getItem(tabDraftKey(username, tabId));
  } catch {
    return null;
  }
  if (tabRaw !== null && tabRaw !== undefined) {
    try {
      return normalizeDraft(JSON.parse(tabRaw));
    } catch {
      return null;
    }
  }

  let legacyRaw;
  try {
    legacyRaw = storage?.getItem(usernameKey(username));
  } catch {
    return null;
  }
  if (!legacyRaw) return null;

  try {
    const legacyDraft = normalizeDraft(JSON.parse(legacyRaw));
    if (!legacyDraft) return null;
    saveScriptDraft(storage, username, tabId, legacyDraft);
    return legacyDraft;
  } catch {
    return null;
  }
}

export function saveScriptDraft(storage, username, tabId, draft) {
  if (!tabId) return false;
  try {
    const normalized = normalizeDraft({ ...draft, version: draftVersion });
    if (!normalized) return false;
    storage?.setItem(tabDraftKey(username, tabId), JSON.stringify({
      ...normalized,
      savedAt: new Date().toISOString()
    }));
    return true;
  } catch {
    return false;
  }
}
