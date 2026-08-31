import { preserveSparsePatch } from './batchFactoryV11State.js';

export function toV10ViewBatch(batch) {
  if (!batch) return null;
  return {
    ...batch,
    items: (batch.books || []).map(book => ({
      ...book,
      id: book.id,
      bookId: book.bookId || book.publicId || book.id,
      videos: Array.isArray(book.videos) ? book.videos : []
    }))
  };
}

function capabilitiesFrom(result) {
  if (!result) return {};
  return result.capabilities && typeof result.capabilities === 'object'
    ? result.capabilities
    : result;
}

function batchesFrom(result) {
  return Array.isArray(result?.batches) ? result.batches : [];
}

export function createBf11UiAdapter(api) {
  if (!api) throw new Error('V11 API client is required');

  return {
    async createBatchFromIntake({ intakeId, payload = {} } = {}) {
      if (!intakeId) throw new Error('V11 intake id is required');
      return api.createBatchFromIntake(intakeId, payload);
    },

    async loadWorkbench({ batchId = '', intakeId = '' } = {}) {
      const capabilityResult = await api.getCapabilities();
      const capabilities = capabilitiesFrom(capabilityResult);
      const batchResult = await api.listBatches();
      const batches = batchesFrom(batchResult);
      const selectedBatchId = batchId || batches[0]?.id || '';
      const [selectedBatchResult, intakeResult] = await Promise.all([
        selectedBatchId ? api.getBatch(selectedBatchId) : Promise.resolve(null),
        intakeId ? api.getIntake(intakeId) : Promise.resolve(null)
      ]);
      return {
        capabilities,
        batches: batches.map(toV10ViewBatch),
        selectedBatch: toV10ViewBatch(selectedBatchResult?.batch || selectedBatchResult),
        selectedBatchId,
        intake: intakeResult?.intake || intakeResult || null,
        startsDirector: false
      };
    },

    async saveDrawer({ scope, batchId, bookId = '', videoId = '', patch = {}, revision = 0 }) {
      const input = {
        patch: preserveSparsePatch(patch),
        expectedRevision: revision
      };
      if (scope === 'batch') return api.saveBatchSettings(batchId, input);
      if (scope === 'book') return api.saveBookOverride(batchId, bookId, input);
      if (scope === 'video') return api.saveVideoOverride(batchId, bookId, videoId, input);
      throw new Error(`Unsupported V11 settings scope: ${scope}`);
    }
  };
}
