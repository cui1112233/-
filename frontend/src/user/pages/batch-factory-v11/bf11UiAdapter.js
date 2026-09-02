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

const PERSONAL_PROMPT_CATEGORIES = ['prefix', 'quality', 'restriction', 'negative'];

function personalPromptRecord(value) {
  const source = value && typeof value === 'object' ? value : {};
  const id = typeof source.id === 'string' ? source.id : '';
  const name = typeof source.name === 'string' ? source.name : '';
  const body = typeof source.body === 'string' ? source.body : '';
  return id && name && body ? { id, name, body, updatedAt: source.updatedAt || null } : null;
}

async function loadPersonalPrompts(api) {
  const empty = Object.fromEntries(PERSONAL_PROMPT_CATEGORIES.map(category => [category, []]));
  if (typeof api.listPersonalConstraintPrompts !== 'function') {
    return { personalPrompts: empty, personalPromptsError: null };
  }
  const results = await Promise.allSettled(PERSONAL_PROMPT_CATEGORIES.map(category => (
    api.listPersonalConstraintPrompts(category)
  )));
  const personalPrompts = { ...empty };
  const failures = [];
  results.forEach((result, index) => {
    const category = PERSONAL_PROMPT_CATEGORIES[index];
    if (result.status === 'rejected') {
      failures.push(`${category}: ${result.reason?.message || '读取失败'}`);
      return;
    }
    const records = Array.isArray(result.value?.prompts) ? result.value.prompts : [];
    personalPrompts[category] = records.map(personalPromptRecord).filter(Boolean);
  });
  return {
    personalPrompts,
    personalPromptsError: failures.length ? { message: failures.join('；') } : null
  };
}

export function configVersionOptions(configVersions) {
  return (Array.isArray(configVersions) ? configVersions : [])
    .filter(record => record && typeof record.id === 'string' && record.id)
    .map(record => ({ value: record.id, label: record.name || record.id }));
}

export function buildConfigVersionSyncPatch(configVersions, versionId) {
  const id = String(versionId || '');
  const exists = (Array.isArray(configVersions) ? configVersions : [])
    .some(record => record?.id === id);
  return exists ? { versionConfigId: id } : null;
}

export function createBf11UiAdapter(api) {
  if (!api) throw new Error('V11 API client is required');

  return {
    async listBatches() {
      const result = await api.listBatches();
      return batchesFrom(result).map(toV10ViewBatch);
    },

    async createBatch(payload = {}) {
      return api.createBatch(payload);
    },

    async saveDraft(payload = {}) {
      return api.saveDraft(payload);
    },

    async createPrompt(payload = {}) {
      return api.createPrompt(payload);
    },

    async createBatchFromIntake({ intakeId, payload = {} } = {}) {
      if (!intakeId) throw new Error('V11 intake id is required');
      return api.createBatchFromIntake(intakeId, payload);
    },

    async loadWorkbench({ batchId = '', intakeId = '' } = {}) {
      const capabilityResult = await api.getCapabilities();
      const capabilities = capabilitiesFrom(capabilityResult);
      const configVersionRequest = Promise.resolve()
        .then(() => api.getConfigVersions())
        .then(result => ({
          configVersions: Array.isArray(result?.configVersions) ? result.configVersions : [],
          configVersionsError: null
        }))
        .catch(error => ({
          configVersions: [],
          configVersionsError: {
            status: Number(error?.status || 0),
            message: error?.message || '读取配置版本失败'
          }
        }));
      const [batchResult, configVersionState] = await Promise.all([
        api.listBatches(),
        configVersionRequest
      ]);
      const personalPromptState = await loadPersonalPrompts(api);
      const batches = batchesFrom(batchResult);
      const { configVersions, configVersionsError } = configVersionState;
      const selectedBatchId = batchId || batches[0]?.id || '';
      const [selectedBatchResult, intakeResult] = await Promise.all([
        selectedBatchId ? api.getBatch(selectedBatchId) : Promise.resolve(null),
        intakeId ? api.getIntake(intakeId) : Promise.resolve(null)
      ]);
      const productionStatus = selectedBatchId && typeof api.getProductionStatus === 'function'
        ? await api.getProductionStatus(selectedBatchId).catch(() => null)
        : null;
      const mergeStatus = selectedBatchId && typeof api.getMergeStatus === 'function'
        ? await api.getMergeStatus(selectedBatchId).catch(() => null)
        : null;
      return {
        capabilities,
        batches: batches.map(toV10ViewBatch),
        selectedBatch: toV10ViewBatch(selectedBatchResult?.batch || selectedBatchResult),
        selectedBatchId,
        intake: intakeResult?.intake || intakeResult || null,
        configVersions,
        configVersionsError,
        personalPrompts: personalPromptState.personalPrompts,
        personalPromptsError: personalPromptState.personalPromptsError,
        productionStatus: productionStatus?.batchId ? productionStatus : null,
        mergeStatus: mergeStatus?.batchId ? mergeStatus : null,
        startsDirector: false
      };
    },

    async previewChangeImpact({ batchId, patch = {}, revision = 0 } = {}) {
      if (!batchId) throw new Error('V11 batch id is required');
      return api.getChangeImpact(batchId, {
        patch: preserveSparsePatch(patch),
        expectedRevision: revision
      });
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
    },

    async runHook({ batchId, bookId } = {}) {
      if (!batchId || !bookId) throw new Error('V11 Batch and Book ids are required');
      return api.runHook(batchId, bookId);
    },

    async approveHook({ batchId, bookId, hookId } = {}) {
      if (!batchId || !bookId || !hookId) throw new Error('V11 Hook identity is required');
      return api.approveHook(batchId, bookId, hookId);
    },

    async runDirector({ batchId, bookId } = {}) {
      if (!batchId || !bookId) throw new Error('V11 Batch and Book ids are required');
      return api.runDirector(batchId, bookId);
    },

    async runBatchDirector({ batchId } = {}) {
      if (!batchId) throw new Error('V11 batch id is required');
      if (typeof api.runBatchDirector !== 'function') throw new Error('批量 Director 接口未接入');
      return api.runBatchDirector(batchId);
    },

    async saveVideoPrompt({ batchId, bookId, videoId, visualPrompt, revision = 0 } = {}) {
      if (!batchId || !bookId || !videoId) throw new Error('V11 Batch, Book and VIDEO ids are required');
      return api.saveVideoOverride(batchId, bookId, videoId, { patch: { visualPrompt }, expectedRevision: revision });
    },

    async previewFinalPrompt({ batchId, bookId, videoId } = {}) {
      if (!batchId || !bookId || !videoId) throw new Error('V11 Batch, Book and VIDEO ids are required');
      const [effectiveResult, promptResult] = await Promise.all([
        api.getEffectiveSettings(batchId, bookId, videoId),
        api.getFinalPrompt(batchId, bookId, videoId)
      ]);
      return {
        effectiveSettings: effectiveResult?.effectiveSettings || effectiveResult,
        finalPrompt: promptResult?.finalPrompt || promptResult
      };
    },

    async runProduction({ batchId, bookId = '', requestId } = {}) {
      if (!batchId || !requestId) throw new Error('V11 batch and request ids are required');
      return bookId
        ? api.submitBookProduction(batchId, bookId, requestId)
        : api.submitBatchProduction(batchId, requestId);
    },

    async runMerge({ batchId, requestId, timingMode = 'speed', speed = 1, ttsSpeed = 1.7 } = {}) {
      if (!batchId || !requestId) throw new Error('V11 batch and request ids are required');
      if (typeof api.submitBatchMerge !== 'function') throw new Error('批量合并接口未接入');
      return api.submitBatchMerge(batchId, { requestId, timingMode, speed: Number(speed), ttsSpeed: Number(ttsSpeed) });
    },

    async getPublishCredential(provider) {
      return api.getPublishCredential(provider);
    },

    async savePublishCredential(provider, payload) {
      return api.savePublishCredential(provider, payload);
    },

    async createPublishIntent(provider, payload) {
      return api.createPublishIntent(provider, payload);
    },

    async confirmPublishIntent(provider, intentId) {
      return api.confirmPublishIntent(provider, intentId);
    },

    async submitPublishIntent(provider, intentId) {
      return api.submitPublishIntent(provider, intentId);
    },

    async getPublishAudits(provider, intentId) {
      return api.getPublishAudits(provider, intentId);
    }
  };
}
