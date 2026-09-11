function normalizeKey(value) {
  return typeof value === 'string' ? value : '';
}

export function createEntityImageRequestGuard(initialKey = '') {
  let activeKey = normalizeKey(initialKey);
  let generation = 0;

  function isCurrent(token) {
    return Boolean(token)
      && token.key === activeKey
      && token.generation === generation;
  }

  return {
    activate(nextKey) {
      const normalized = normalizeKey(nextKey);
      if (normalized !== activeKey) {
        activeKey = normalized;
        generation += 1;
      }
    },
    begin() {
      return { key: activeKey, generation };
    },
    isCurrent,
    commit(token, apply) {
      if (!isCurrent(token)) return false;
      apply();
      return true;
    },
    invalidate() {
      generation += 1;
    }
  };
}
