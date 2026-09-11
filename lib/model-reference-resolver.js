const MODEL_REFERENCE_KEYS = new Set(['modelId', 'textModelId', 'imageModelId', 'videoModelId']);

function containsModelReference(value, modelId, seen = new Set()) {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some(entry => containsModelReference(entry, modelId, seen));
  return Object.entries(value).some(([key, entry]) => (
    MODEL_REFERENCE_KEYS.has(key) && String(entry || '').trim() === modelId
  ) || containsModelReference(entry, modelId, seen));
}

function createModelReferenceResolver({ configReader, batchFactoryStoreFactory, accountReader } = {}) {
  return async function isModelReferenced({ ownerUsername, modelId }) {
    try {
      if (typeof configReader !== 'function') return true;
      if (containsModelReference(configReader(ownerUsername), modelId)) return true;

      if (!batchFactoryStoreFactory) return true;
      if (typeof accountReader !== 'function' || typeof batchFactoryStoreFactory.forAccount !== 'function') return true;
      const account = accountReader(ownerUsername);
      if (!account) return true;
      const store = batchFactoryStoreFactory.forAccount(account);
      if (!store || typeof store.listBatches !== 'function') return true;
      const batches = await store.listBatches(ownerUsername);
      if (!Array.isArray(batches)) return true;
      return containsModelReference(batches, modelId);
    } catch (_) {
      // A missing or unreadable persistent source must never permit a dangling model deletion.
      return true;
    }
  };
}

module.exports = { containsModelReference, createModelReferenceResolver };
