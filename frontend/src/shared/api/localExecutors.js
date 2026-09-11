export function parseLocalExecutorsResponse(payload) {
  if (Array.isArray(payload?.executors)) return payload.executors;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

export function hasReadyLocalExecutor(executors) {
  return Array.isArray(executors) && executors.some(item => item?.online === true);
}

export function normalizeLocalExecutorsResponse(payload) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  return { ...source, executors: parseLocalExecutorsResponse(payload) };
}
