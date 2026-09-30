export function selectGiantExecutorHealth(local, backendOnline) {
  if (local?.online === true && local?.bindingState === 'online') return local;
  return backendOnline || local || null;
}
