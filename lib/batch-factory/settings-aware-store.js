const { createBatchFactoryStore } = require('./store');
const {
  applyCachedPersistedSettingsState,
  cachedPersistedSettingsState
} = require('./settings-state-bridge');

function createSettingsAwareBatchFactoryStore(baseStore = createBatchFactoryStore()) {
  return {
    ...baseStore,
    listBatches(username) {
      return baseStore.listBatches(username).map(batch => {
        const cached = cachedPersistedSettingsState(username, batch.id);
        if (cached?.persisted !== true) return batch;
        return {
          ...batch,
          settings: cached.state?.settings && typeof cached.state.settings === 'object'
            ? cached.state.settings
            : {}
        };
      });
    },
    getBatch(username, batchId) {
      return applyCachedPersistedSettingsState(baseStore.getBatch(username, batchId), username);
    }
  };
}

module.exports = { createSettingsAwareBatchFactoryStore };
