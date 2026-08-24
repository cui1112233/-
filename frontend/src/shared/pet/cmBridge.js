export const CM_BRIDGE_CONTEXT_EVENT = 'qiantie:cm-bridge-context';
export const CM_BRIDGE_SELECTION_EVENT = 'qiantie:cm-bridge-selection';
export const CM_BRIDGE_ACTION_EVENT = 'qiantie:cm-bridge-action';
export const CM_BRIDGE_ACTION_RESULT_EVENT = 'qiantie:cm-bridge-action-result';
export const CM_BRIDGE_UNDO_EVENT = 'qiantie:cm-bridge-undo';

export const CM_ACTION_TYPES = Object.freeze([
  'character.update',
  'character.create',
  'character.delete',
  'character.setProtagonist',
  'scene.update',
  'scene.create',
  'scene.delete',
  'script.replace',
  'script.insert',
  'shot.update',
  'constraint.bind',
  'constraint.update',
  'asset.update',
  'asset.create',
  'segment.update',
  'segment.bindAsset',
  'tts.update'
]);

const actionTypes = new Set(CM_ACTION_TYPES);

function text(value, limit = 240) {
  return String(value ?? '').trim().slice(0, limit);
}

function makeRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeCmSelection(value) {
  if (!value || typeof value !== 'object') return null;
  const type = text(value.type, 48);
  const id = text(value.id, 160);
  const label = text(value.label || value.name, 160);
  if (!type && !id && !label) return null;
  return {
    type,
    id,
    label,
    meta: value.meta && typeof value.meta === 'object' ? value.meta : {}
  };
}

export function normalizeCmCapabilities(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => text(item, 80)).filter(Boolean))].slice(0, 40);
}

export function normalizeCmBridgeContext(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    page: text(source.page, 120),
    pagePath: text(source.pagePath, 240),
    project: source.project && typeof source.project === 'object' ? source.project : null,
    selection: normalizeCmSelection(source.selection),
    capabilities: normalizeCmCapabilities(source.capabilities),
    summary: text(source.summary, 1200),
    canApply: source.canApply === true
  };
}

export function dispatchCmBridgeContext(context) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CM_BRIDGE_CONTEXT_EVENT, {
    detail: normalizeCmBridgeContext(context)
  }));
}

export function dispatchCmSelection(selection) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CM_BRIDGE_SELECTION_EVENT, {
    detail: normalizeCmSelection(selection)
  }));
}

export function normalizeCmAction(action) {
  if (!action || typeof action !== 'object') return null;
  const type = text(action.type, 80);
  if (!actionTypes.has(type)) return null;
  return {
    type,
    targetId: text(action.targetId, 160),
    label: text(action.label, 160),
    patch: action.patch && typeof action.patch === 'object' ? action.patch : {},
    payload: action.payload && typeof action.payload === 'object' ? action.payload : {}
  };
}

export function dispatchCmAction(action, meta = {}) {
  if (typeof window === 'undefined') return '';
  const normalized = normalizeCmAction(action);
  if (!normalized) return '';
  const requestId = makeRequestId();
  window.dispatchEvent(new CustomEvent(CM_BRIDGE_ACTION_EVENT, {
    detail: {
      requestId,
      action: normalized,
      meta: meta && typeof meta === 'object' ? meta : {}
    }
  }));
  return requestId;
}

export function dispatchCmActionResult(requestId, result = {}) {
  if (typeof window === 'undefined' || !requestId) return;
  window.dispatchEvent(new CustomEvent(CM_BRIDGE_ACTION_RESULT_EVENT, {
    detail: {
      requestId: text(requestId, 160),
      ok: result.ok === true,
      message: text(result.message, 300),
      undoToken: text(result.undoToken, 240)
    }
  }));
}

export function dispatchCmUndo(undoToken) {
  if (typeof window === 'undefined' || !undoToken) return;
  window.dispatchEvent(new CustomEvent(CM_BRIDGE_UNDO_EVENT, {
    detail: { undoToken: text(undoToken, 240) }
  }));
}
