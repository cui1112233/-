export function createEntityImageRequestGuard(initialKey = '') {
  let activeKey = String(initialKey || '');
  let generation = 0;
  const current = token => Boolean(token) && token.key === activeKey && token.generation === generation;
  return {
    activate(nextKey) {
      const key = String(nextKey || '');
      if (key !== activeKey) { activeKey = key; generation += 1; }
    },
    begin() { return { key: activeKey, generation }; },
    isCurrent: current,
    commit(token, apply) { if (!current(token)) return false; apply(); return true; },
    invalidate() { generation += 1; }
  };
}
